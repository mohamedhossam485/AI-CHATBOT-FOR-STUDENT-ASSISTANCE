# V-ASA v3.0 - Ultra-Compact Edition



## Step-by-Step Guide (PowerShell)

### Step 1: Check Prerequisites
```powershell
# Check Node.js version (need v14+)
node --version

# Check npm version
npm --version

# Check Python version (need v3.7+)
python --version
```

### Step 2: Navigate to Project Folder
```powershell
# Open PowerShell and go to project directory
cd C:\Users\48780\Desktop\vistula-ai-assistant-3
```

### Step 3: Install Node.js Dependencies
```powershell
# Install all required Node.js packages
npm install
```
**Expected output:** Packages will be installed in `node_modules/` folder

### Step 4: Install Python Dependencies
```powershell
# Install Python packages (if you have requirements.txt)
pip install -r requirements.txt

# Or install manually:
pip install flask sentence-transformers scikit-learn joblib
```

### Step 5: Create .env File (If Not Exists)
```powershell
# Create .env file with your API key
# Option 1: Using PowerShell
@"
GROQ_API_KEY=your_groq_api_key_here
PORT=4000
RAG_MODE=keyword
EMBEDDING_SERVICE_URL=http://localhost:6000
RERANKER_SERVICE_URL=http://localhost:6001
"@ | Out-File -FilePath .env -Encoding utf8


