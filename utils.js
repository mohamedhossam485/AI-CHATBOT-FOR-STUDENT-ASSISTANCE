const fileSystem = require('fs');
const path = require('path');
const axios = require('axios');
//  ** get from stored data when need it **
let pages = [];
let chunks_data = [];
let embeddings = null;
//  ** get data from json file tha we scrapped **
const loadData = () => {
  try {
    pages = JSON.parse(
      fileSystem.readFileSync(
        path.join(__dirname, 'data', 'vistula_pages.json'),
        'utf-8'
      )
    );
  } catch {
    pages = [];
  }
  try {
    chunks_data = JSON.parse(
      fileSystem.readFileSync(
        path.join(__dirname, 'rag', 'vistula_chunks.json'),
        'utf-8'
      )
    );
  } catch {
    chunks_data = [];
  }
  try {
    embeddings = JSON.parse(
      fileSystem.readFileSync(
        path.join(__dirname, 'rag', 'vistula_embeddings.json'),
        'utf-8'
      )
    );
  } catch {
    embeddings = null;
  }
};
//  ** find pages match the requast **
const search = (q, max = 25) => {
  if (!pages || !pages.length) loadData();
  if (!pages || !pages.length) return [];
  const query = q.toLowerCase();
  const synonyms = {
    fee: ['tuition', 'cost'],
    admission: ['apply'],
    program: ['course'],
  };
  //  ** get search words **
  let words = q
    .toLowerCase()
    .split(/\s+/)
    .filter(x => x.length >= 2);
  words.forEach(x => synonyms[x] && words.push(...synonyms[x]));
  words = [...new Set(words)];
  //  ** find pages **
  return pages
    .map(p => {
      const text = [p.title || '', (p.headings || []).join(' '), p.text || '']
        .join(' ')
        .toLowerCase();
      let score = text.includes(query) ? 10 : 0;
      let matches = 0;
      words.forEach(word => {
        if (text.includes(word)) {
          matches++;
          score += 1;
          if ((p.title || '').toLowerCase().includes(word)) score += 5;
          const count = (text.match(new RegExp(word, 'g')) || []).length;
          if (count > 1) score += Math.min(count - 1, 3);
        }
      });
      return matches >= 3
        ? {
            url: p.url,
            title: p.title,
            text: p.text,
            score: Math.floor(score * 1.2),
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ score, ...r }) => r);
};
//  ** compare and calculate between the vectors (2) **
const cosine = (a, b) => {
  let dot = 0;
  let Normalization_A = 0;
  let Normalization_B = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    Normalization_A += a[i] * a[i];
    Normalization_B += b[i] * b[i];
  }
  const den = Math.sqrt(Normalization_A) * Math.sqrt(Normalization_B);
  return den === 0 ? 0 : dot / den;
};
//  ** get emd from serv **
const embed = async q => {
  try {
    const r = await axios.post(
      `${process.env.EMBEDDING_SERVICE_URL || 'http://localhost:6000'}/embed`,
      { text: q },
      { timeout: 5000 }
    );
    return r.data.embedding;
  } catch {
    return null;
  }
};
//  ** compare similarty **
const vector = async (q, topK = 10) => {
  loadData();
  if (!embeddings || !chunks_data.length) return [];
  const qEmbed = await embed(q);
  if (!qEmbed) return [];
  //  ** calc similarty **
  return embeddings
    .map((e, i) => ({
      index: i,
      sim: cosine(qEmbed, e),
      chunk: chunks_data[i],
    }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, topK)
    .map(i => ({
      url: i.chunk.url,
      title: i.chunk.title,
      chunk_id: i.chunk.chunk_id,
      text: i.chunk.text,
      similarity_score: i.sim,
    }));
};
//  ** hybrid searching **
const hybrid = async (q, topK = 20) => {
  const [kw, vec] = await Promise.all([
    Promise.resolve(search(q, Math.floor(topK * 1.5))),
    vector(q, Math.floor(topK * 1.5)),
  ]);
  const map = new Map();
  //  ** compine output **
  [...kw, ...vec].forEach(r => {
    const key = `${r.url}|${r.chunk_id || 'd'}`;
    const existing = map.get(key);
    if (existing) {
      existing.vector_score = r.similarity_score || existing.vector_score || 0;
      existing.source = 'hybrid';
    } else {
      map.set(key, {
        url: r.url,
        title: r.title,
        chunk_id: r.chunk_id,
        text: r.text,
        vector_score: r.similarity_score || 0,
        lexical:
          q
            .toLowerCase()
            .split(/\s+/)
            .filter(w => w.length > 2)
            .filter(w => r.text.toLowerCase().includes(w)).length /
          r.text.split(/\s+/).length,
        source: r.similarity_score ? 'vector' : 'keyword',
      });
    }
  });
  //  ** reorder-return **
  return Array.from(map.values())
    .sort((a, b) =>
      Math.abs(b.vector_score - a.vector_score) > 0.01
        ? b.vector_score - a.vector_score
        : b.lexical - a.lexical
    )
    .slice(0, topK)
    .map(({ vector_score, lexical, source, ...r }) => r);
};

module.exports = { search, vector, hybrid, loadData };
