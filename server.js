//  **load env **
require('dotenv').config();

const express = require('express');
const axios = require('axios');
const fileSystem = require('fs');
const path = require('path');
const { search, vector, hybrid } = require('./utils');
// ** set env **
const app = express();
const PORT = process.env.PORT || 4000;
const RAG_MODE = process.env.RAG_MODE || 'keyword';
// ** memoryspace **
let cache = {};
let memory = {};
// ** get topics config **
const config = JSON.parse(
  (() => {
    try {
      return fileSystem.readFileSync(
        path.join(__dirname, 'config', 'topics.json'),
        'utf-8'
      );
    } catch {
      return '{"topics":[]}';
    }
  })()
);
// ** add synon to quary **
const enhance = q => {
  const synonyms = {
    program: 'course degree',
    fee: 'tuitions Fees',
    admission: 'apply',
    contact: 'email & phone',
    location: 'campus',
  };
  return (
    q +
    ' ' +
    Object.entries(synonyms)
      .filter(([k]) => q.toLowerCase().includes(k))
      .map(([, v]) => v)
      .join(' ')
  );
};
// ** send searching  result **
const getRAG = async q => {
  const key = q.toLowerCase();
  if (cache[key]) return cache[key];
  let results = [];
  switch (RAG_MODE) {
    case 'vector':
      results = await vector(q, 25);
      break;
    case 'hybrid':
      results = await hybrid(q, 25);
      break;
    case 'hybrid_rerank':
      const hybridResults = await hybrid(q, 30);
      try {
        const res = await axios.post(
          `${
            process.env.RERANKER_SERVICE_URL || 'http://localhost:6001'
          }/rerank`,
          {
            question: q,
            snippets: hybridResults.map(x => ({
              text: x.text,
              title: x.title,
              url: x.url,
              chunk_id: x.chunk_id,
            })),
          },
          { timeout: 5000 }
        );
        results =
          res.data?.reranked?.slice(0, 25) || hybridResults.slice(0, 25);
      } catch {
        results = hybridResults.slice(0, 25);
      }
      break;
    default:
      results = search(enhance(q), 25);
  }
  cache[key] = results;
  return results;
};
// ** bot mission **
const promp = () => `You are V-ASA, Vistula University AI assistant. 
You ONLY answer questions about Vistula University and student life in Warsaw,
Poland. NOTHING ELSE.
CRITICAL RULES:
- ONLY discuss: Vistula University programs, admissions, fees,
campus, student life in Warsaw, accommodation, transportation, 
food, discounts, libraries, safety tips, Polish culture
- If asked about anything else, politely redirect:
"I specialize in Vistula University and student life in Warsaw.
How can I help with that?"
- Use ONLY the provided information from Vistula website
- Be concise, helpful, accurate
 no need to say things like this (I'm a large language model),
 you can say only if the user ask you about your capabilities.
- After EVERY answer: 4-5 Vistula/Warsaw related suggestions, 4-5 follow-up questions, 3-4 help offers
- End with: "What else would you like to know about Vistula or Warsaw?"`;
// ** result  build search **
const ctx = results =>
  results.length
    ? `VISTULA UNIVERSITY INFORMATION:\n` +
      results
        .map(
          (p, i) =>
            `[${i + 1}] ${p.title}\n${p.url}\n${p.text.slice(
              0,
              i < 3 ? 8000 : i < 5 ? 6000 : 4000
            )}\n---`
        )
        .join('\n\n') +
      `\nUse ONLY this information. If question is not about Vistula/Warsaw, redirect politely.`
    : 'No Vistula data found. Say you only help with Vistula University and Warsaw student life.';
// ** Middleware **
app.use(require('cors')());
app.use(express.json());
app.use(express.static('frontend'));
// ** api roads **
app.get('/api/topics', (req, res) => res.json(config));
app.get('/api/health', (req, res) => res.json({ status: 'ok', v: '3.0' }));
// ** chat endroad **
app.post('/api/chat', async (req, res) => {
  try {
    const {
      message,
      sessionId = 'default',
      greetingAlreadyShown = true,
    } = req.body;
    //** inputsize **
    if (!message?.trim())
      return res.status(400).json({ error: 'Message required' });
    if (!process.env.GROQ_API_KEY)
      return res.status(500).json({ error: 'API key missing' });
    // ** res from search **
    let results = [];
    try {
      results = await getRAG(message);
    } catch (e) {
      console.error('RAG Error:', e.message);
    }
    const context = ctx(results);
    // ** set memory load **
    if (!memory[sessionId]) memory[sessionId] = [];
    // ** remmmber previos messages **
    const history = memory[sessionId].slice(-20);
    // ** ai reply **
    const messages = [
      { role: 'system', content: promp() },
      { role: 'system', content: context },
    ];
    if (history.length > 0) messages.push(...history);
    messages.push({ role: 'user', content: message });
    // ** get the api keyfrom env **
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: messages,
        temperature: 0.7,
        max_tokens: 16384,
        top_p: 0.9,
        frequency_penalty: 0.3,
        presence_penalty: 0.3,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    //**  reply vali **
    if (!response.data?.choices?.[0]?.message?.content)
      throw new Error('Invalid API response');
    const reply = response.data.choices[0].message.content;
    // ** savechat **
    memory[sessionId].push(
      { role: 'user', content: message },
      { role: 'assistant', content: reply }
    );
    if (memory[sessionId].length > 40)
      memory[sessionId] = memory[sessionId].slice(-40);
    res.json({ reply });
  } catch (e) {
    console.error('Error:', e.message, e.stack);
    res
      .status(500)
      .json({
        error: 'Error',
        details: e.response?.data?.error?.message || e.message,
      });
  }
});
// ** startserver **
app.listen(PORT, () => console.log(` V-ASA v3.0 → http://localhost:${PORT}`));
