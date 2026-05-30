# TradeMirror MVP — Setup Guide
## Zero coding experience required. Follow exactly.

---

## What you're building

A Telegram bot that:
1. Learns a trader's biggest behavioral mistake during onboarding
2. Analyzes chart screenshots with Claude Vision AI
3. Detects overtrading, revenge trading, and outside-session patterns
4. Sends proactive intervention messages BEFORE the analysis
5. Asks a specific reflection question with every assessment

Total setup time: ~30 minutes

---

## What you need

- A computer (Mac or Windows)
- A Telegram account
- A credit card (for Anthropic API — pay as you go, ~$5/month for heavy usage)

---

## Step 1 — Install Node.js (5 minutes)

Node.js is the engine that runs the bot.

1. Go to **https://nodejs.org**
2. Click the green **LTS** button to download
3. Open the downloaded file and click through the installer (Next, Next, Finish)
4. Open **Terminal** (Mac: press Cmd+Space, type "Terminal") or **Command Prompt** (Windows: press Windows key, type "cmd")
5. Type this and press Enter:
   ```
   node --version
   ```
   You should see something like `v20.11.0`. If you do, Node.js is installed.

---

## Step 2 — Create your Telegram bot (5 minutes)

1. Open Telegram on your phone or desktop
2. Search for **@BotFather**
3. Tap **Start**
4. Send: `/newbot`
5. When asked for a name, send: `TradeMirror`
6. When asked for a username, send something like: `TradeMirrorYourName_bot`
   (must be unique — add your name or numbers if it's taken)
7. BotFather will send you a token that looks like:
   `7123456789:AAGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
8. **Copy this token and save it somewhere safe**

---

## Step 3 — Get your Anthropic API key (5 minutes)

This powers the AI chart analysis.

1. Go to **https://console.anthropic.com**
2. Create a free account
3. Click **API Keys** in the left menu
4. Click **Create Key**
5. Name it `trademirror`
6. Copy the key — it starts with `sk-ant-`
7. **Save it somewhere safe — you only see it once**

> **Cost:** The API charges per analysis. One chart analysis costs roughly $0.003
> (less than half a cent). At 50 analyses/day that's about $4.50/month.
> Add a $5–10 credit to start — it'll last weeks.

---

## Step 4 — Set up the project (10 minutes)

1. **Download the project files** (this folder)

2. **Open Terminal/Command Prompt and navigate to the folder:**
   ```
   cd path/to/trademirror-mvp
   ```
   On Mac, you can drag the folder into Terminal after typing `cd ` (with a space).

3. **Install dependencies** (downloads everything the bot needs):
   ```
   npm install
   ```
   This takes 1–2 minutes. You'll see lots of text — that's normal.

4. **Create your config file:**
   ```
   cp .env.example .env
   ```
   On Windows:
   ```
   copy .env.example .env
   ```

5. **Open the `.env` screefile** in any text editor (Notepad, TextEdit, VS Code):
   ```
   TELEGRAM_BOT_TOKEN=paste_your_telegram_token_here
   ANTHROPIC_API_KEY=paste_your_anthropic_key_here
   ```
   Replace the placeholder text with your actual keys. No quotes needed.

---

## Step 5 — Run the bot (2 minutes)

In Terminal, run:
```
npm start
```

You should see:
```
🪞  TradeMirror MVP is running
    Behavioral intervention system active
    Waiting for traders...
```

**Open Telegram, find your bot by its username, and send `/start`**

The onboarding conversation should begin immediately.

---

## Step 6 — Test it properly

Go through the full onboarding as a trader would:

1. `/start` → answer the mistake question honestly
2. Select your trigger from the buttons
3. Select your session
4. Send 4–5 chart screenshots in quick succession
5. Watch the overtrading intervention fire after the 4th chart
6. Check `/stats` to see your discipline score

**The intervention is the product.** Make sure it feels specific, not generic.

---

## Step 7 — Deploy to Railway (always-on hosting)

Running locally means the bot stops when you close your computer. Railway hosts it permanently for free.

1. Go to **https://railway.app** and create a free account
2. Install the Railway tool:
   ```
   npm install -g @railway/cli
   ```
3. Log in:
   ```
   railway login
   ```
4. Deploy:
   ```
   railway init
   railway up
   ```
5. Go to your Railway dashboard → your project → **Variables** tab
6. Add both variables:
   - `TELEGRAM_BOT_TOKEN` = your token
   - `ANTHROPIC_API_KEY` = your key
7. Railway redeploys automatically

Your bot is now live 24/7.

---

## The exact conversation flow your users will see

### Onboarding (happens once, on /start):

**Bot:** "Hey [Name]. I'm TradeMirror. I'm not a chart analyzer. I'm not a journal. I watch how you trade — and I interrupt you when you're about to repeat the mistake you always make. What's the one trading mistake you keep making that you can't seem to stop?"

**User:** [types their answer, e.g. "I revenge trade after losses"]

**Bot:** "Got it. 'I revenge trade after losses.' When this happens, what triggers it?" [shows 4 buttons]

**User:** [taps "Frustration after a loss"]

**Bot:** "Last question: when do you do most of your trading?" [shows 4 session buttons]

**User:** [taps "London (07:00–12:00 UTC)"]

**Bot:** "Here's what I know about you:
🔁 Pattern: I revenge trade after losses
⚡ Trigger: Frustration after a loss
⏰ Session: London (07:00–12:00 UTC)

I'm going to watch for this. When I see the pattern starting, I'll interrupt you.

**You may not like it when I do. That's the point.**

Send me a chart when you're ready."

---

### Normal usage (every time they send a chart):

**[If behavioral pattern detected — fires BEFORE analysis:]**

"⚠️ **Revenge window active**

You had a rapid sequence of charts 12 minutes ago. That pattern shows up when a trade just went wrong.

You told me your hardest pattern is: *'I revenge trade after losses'*

Is this a fresh setup from your plan — or are you trying to get something back?"

**[Then the analysis follows:]**

"📊 **TRADE ASSESSMENT**
NQ Long, IFVG Setup

✅ **For:**
• Long from discount zone
• Liquidity swept above highs
• RR appears > 1:2

⚠️ **Against:**
• High-impact news in 22 minutes
• Trading against daily trend

❓ **Missing:**
• H1 bias not visible in this screenshot

🪞 This is your second NQ long in 40 minutes. The first one didn't work out — are you adjusting your thesis, or doubling down on the same idea?"

---

## Commands reference

| Command | What it does |
|---|---|
| `/start` | Begin onboarding (or restart it) |
| `/setrule [text]` | Add a personal rule |
| `/rules` | View your rules |
| `/delrule [number]` | Remove a rule |
| `/stats` | Today's discipline score |
| `/profile` | Your full behavioral profile |
| `/plan` | Current plan + upgrade info |
| `/help` | All commands |

---

## Intervention triggers (what fires and when)

| Pattern | Trigger condition | Fires again today? |
|---|---|---|
| Overtrading | 4+ charts in 90 minutes | No — once per day |
| Revenge window | Chart within 25 min of fast sequence | No — once per day |
| Outside session | Chart outside stated trading hours | No — once per day |

---

## File structure

```
trademirror-mvp/
├── bot.js           ← Main bot (Telegram handler + commands)
├── db.js            ← Behavioral memory (SQLite database)
├── interventions.js ← Pattern detection + intervention messages
├── ai.js            ← Claude Vision analysis + prompt
├── package.json     ← Dependencies
├── .env.example     ← Config template
├── .env             ← Your config (never share this)
└── SETUP.md         ← This file
```

---

## Common problems

**"Cannot find module" error**
→ Run `npm install` again

**Bot doesn't respond**
→ Check your TELEGRAM_BOT_TOKEN in .env (no spaces, no quotes)

**"Invalid API key" error**
→ Check your ANTHROPIC_API_KEY in .env — make sure it starts with sk-ant-

**Intervention not firing**
→ You need to send 4+ charts within 90 minutes. Send them quickly to test.

**Chart analysis says "couldn't parse"**
→ The image might be too small. Use a full screenshot, not a cropped thumbnail.

---

## Upgrading users manually (before you build Stripe)

For now, when someone wants to upgrade:
1. They message you directly
2. You take payment (PayPal, bank transfer, whatever)
3. You run this command in Railway's shell:
   ```
   node -e "
   import('./db.js').then(({getDb}) => getDb().then(db => {
     db.run('UPDATE users SET plan = ? WHERE user_id = ?', ['pro', 'THEIR_USER_ID']);
     console.log('done');
   }));
   "
   ```
   Replace `THEIR_USER_ID` with their Telegram user ID (they can get it by messaging @userinfobot)

Build Stripe later. Manually upgrading your first 20 users is fine and keeps you close to them.

---

## What to build next (after first 20 users)

1. Stripe payment link for /plan command
2. Weekly AI behavioral review (Sunday mornings)
3. FOMO detection (same instrument + direction 3x in a row)

Don't build anything else until you have 20 active paying users telling you what they need.
