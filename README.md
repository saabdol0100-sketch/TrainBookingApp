# TrainBookingApp

## 🔧 Setup

1. Clone repo
2. Run:
   npm install
3. Copy env:
   cp .env.example .env
4. Fill required variables
5. Run:
   npm run dev

## 🗄️ Database Setup

To restore the MongoDB database:

1. Make sure MongoDB is installed and running.
2. Clone this repo.
3. Run the following command in your terminal (CMD, PowerShell, or VS Code integrated terminal):

   ```bash
   mongorestore --drop --db trainbooking ./db-dump/trainbooking
   ```
