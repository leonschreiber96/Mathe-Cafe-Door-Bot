# Cafe Door Telegram Notifier

This small project polls the cafe door status page and notifies subscribed Telegram users when the door opens or closes.

Requirements
- Python 3.8+
- A virtualenv (you mentioned you already created one) with `aiogram` installed and `requests`

Setup
1. Create a bot and get a token from @BotFather on Telegram.
2. Set the token in your environment before running the bot (zsh example):

```bash
export TELEGRAM_BOT_TOKEN="<your-token-here>"
```

3. Install dependencies (if not already):

```bash
# inside your virtualenv
pip install aiogram requests
```

Run

```bash
python main.py
```

Commands supported (Telegram):
- /subscribe — subscribe to door notifications
- /unsubscribe — stop notifications
- /status — query current door status immediately

Notes
- The bot expects the door status page at https://door.mathe-cafe.de. The parser is intentionally small and heuristic-based; if the page format changes significantly a more robust parser (e.g., HTML parsing with BeautifulSoup) may be necessary.
- Subscribers are stored in `data/subscribers.json` in the repository folder.
