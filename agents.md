# Project Description
Our cafe has a sensor that detects whether the door is open or closed. This project aims to create a telegram bot that users can subscribe to in order to receive notifications when the door status changes.

# Tech Details
The program must crawl the specified URL every minute to check the door status. If the status changes (from open to closed or vice versa), the bot will send a notification to all subscribed users.

The project uses the following technologies:
- Python
- Telegram Bot API (aiogram)
- Python Requests library for scraping the door status

# Other
- The door status url is: https://door.mathe-cafe.de
- An example of the door status page content can be found in example.html
- The bot should handle user subscriptions and unsubscriptions for notifications.
- The bot should be able to handle multiple users simultaneously.