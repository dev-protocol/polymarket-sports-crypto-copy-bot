<h1 align="center">Polymarket Copy Trading Bot (CLOB API + RTDS)</h1>

<p align="center">
  <img src="https://raw.githubusercontent.com/dev-protocol/polymarket-sports-crypto-copy-bot/main/public/s.gif" width="700" alt="Polymarket Copy Trading Bot Demo"/>
</p>

<p align="center">
Automated <strong>Polymarket copy trading bot</strong> built with <strong>Node.js + Express</strong>.<br>
Streams real-time activity via <strong>RTDS</strong> and executes trades using the <strong>Polymarket CLOB API</strong> on Polygon.
</p>

<p align="center">
  <b>Polymarket Trading Bot</b> • 
  <b>Copy Trading Automation</b> • 
  <b>Prediction Market Bot</b> • 
  <b>Polygon CLOB Integration</b>
</p>

---

<h2>Features</h2>

<ul>
  <li>Real-time wallet activity streaming (RTDS)</li>
  <li>Automatic copy trade execution</li>
  <li>CLOB order placement</li>
  <li>Polygon network support</li>
  <li>Express backend + HTML frontend</li>
  <li>Private key authentication</li>
  <li>401 / Invalid API key handling</li>
</ul>

---

<h2>Tech Stack</h2>

<ul>
  <li>Node.js</li>
  <li>Express.js</li>
  <li>Polymarket CLOB API</li>
  <li>Polymarket RTDS WebSocket</li>
  <li>Polygon (EVM)</li>
</ul>

---

<h2>How It Works</h2>

<ol>
  <li>Connects to Polymarket RTDS stream</li>
  <li>Monitors target wallet activity</li>
  <li>Detects trade events</li>
  <li>Replicates trades via CLOB API</li>
  <li>Signs transactions using your private key</li>
</ol>

<p>
This enables automated <strong>real-time copy trading on Polymarket</strong>.
</p>

---

<h2>Installation</h2>

<h3>1. Clone Repository</h3>

<pre><code>git clone https://github.com/dev-protocol/polymarket-sports-crypto-copy-bot.git
cd polymarket-sports-crypto-copy-bot
</code></pre>

<h3>2. Install Dependencies</h3>

<pre><code>npm install
</code></pre>

<h3>3. Setup Environment</h3>

<pre><code>cp .env.example .env
</code></pre>

<table>
<tr>
<th>Variable</th>
<th>Required</th>
<th>Description</th>
</tr>
<tr>
<td><code>PRIVATE_KEY</code></td>
<td>Yes</td>
<td>EOA private key (0x…) linked to Polymarket</td>
</tr>
<tr>
<td><code>POLYGON_RPC_URL</code></td>
<td>No</td>
<td>Polygon RPC endpoint (default: https://polygon-rpc.com)</td>
</tr>
</table>

---

<h2>Running the Bot</h2>

<pre><code>npm run build
npm start
</code></pre>

<p>For development:</p>

<pre><code>npx nodemon
</code></pre>

---

<h2>Fix 401 Unauthorized / Invalid API Key</h2>

If you see:

<ul>
<li><code>401 Unauthorized</code></li>
<li><code>Invalid API key</code></li>
</ul>

Possible causes:

<ul>
  <li>Wallet is not linked to Polymarket</li>
  <li>Derived API key was revoked</li>
  <li>Region/API restriction</li>
</ul>

After a 401 error:
<ul>
  <li>The bot clears the CLOB client</li>
  <li>Stops heartbeats</li>
  <li>Requires restart after fixing wallet/key</li>
</ul>

---

<h2>Security</h2>

<ul>
  <li>Never commit your <code>.env</code> file</li>
  <li>Never share your private key</li>
  <li>Use a dedicated wallet with limited funds</li>
</ul>

---

<h2>Use Cases</h2>

<ul>
  <li>Polymarket copy trading bot</li>
  <li>Whale tracking automation</li>
  <li>Prediction market strategy replication</li>
  <li>Algorithmic trading research</li>
</ul>

---

<h2>SEO Keywords</h2>

<p>
Polymarket trading bot, Polymarket copy trading bot, Polymarket CLOB API example, 
Polymarket RTDS stream, Polygon trading bot, crypto prediction market automation, 
Web3 trading bot Node.js, Polymarket API integration
</p>

---

<h2>Disclaimer</h2>

<p>
This project is for educational purposes only. Trading prediction markets involves financial risk.
Use at your own risk.
</p>
