require('dotenv').config();
const cron = require('node-cron');
const fetchQuote = require('./helper/getQuote');
const supabase = require('./helper/getSupaBaseClient');
const bot = require('./helper/getTelagramBot.js');
const express = require('express');

// --- 1. SETUP SERVER & STATE ---

const app = express();
const userStates = {}; // Stores user state: { chat_id: 'WAITING_FOR_NAME' }

// --- 2. BOT COMMANDS ---

// Handle /start
bot.start((ctx) => {
    const chatID = ctx.chat.id;
    // Set the state for this user to wait for their name
    userStates[chatID] = 'WAITING_FOR_NAME';
    ctx.reply("Welcome! 🚀\nTo subscribe to daily motivation, please enter your name:");
});

// Handle /stop (Sign Out)
bot.command('stop', async (ctx) => {
    const chatID = ctx.chat.id;
    console.log(`Stop by  : ${chatID}`);
    
    try {
        const { error } = await supabase
            .from('subscribers')
            .update({ is_active: false })
            .eq('chat_id', chatID);

        if (error){
            console.log(`Error in update (stop) : ${error} `);
            throw error;
        } 

        ctx.reply("You have been unsubscribed. 🔕\nYou won't receive daily quotes anymore.\n\nType /start if you want to join again!", {
            reply_markup: { remove_keyboard: true }
        });
        console.log(`User unsubscribed: ${chatID}`);

    } catch (err) {
        console.error('Error unsubscribing:', err);
        ctx.reply("Something went wrong. Please try again.");
    }
});

// Helper function to send quote
const sendQuoteNow = async (ctx) => {
    ctx.sendChatAction('typing');
    console.log(`Sending Quote : ${ctx}`);
    const quote = await fetchQuote();
    ctx.reply(quote);
};

// Listen for command AND button text
bot.command('quote', sendQuoteNow);
bot.hears('💡 Get Motivation Now', sendQuoteNow);

// Handle Text Messages (For Name Input)
bot.on('text', async (ctx) => {
    const chatID = ctx.chat.id;
    const incomingText = ctx.message.text;

    
    console.log(`Text Received from ${chatID} : ${incomingText}`);

    // Check if we are waiting for a name
    if (userStates[chatID] === 'WAITING_FOR_NAME') {
        try {
            // A. Save to Supabase
            const { error } = await supabase
                .from('subscribers')
                .upsert({
                    chat_id: chatID,
                    first_name: incomingText,
                    is_active: true
                }, { onConflict: 'chat_id' });

            if (error) throw error;

            // B. Clear State
            delete userStates[chatID];

            // C. Reply with Button
            ctx.reply(`Thanks ${incomingText}! You are now subscribed. You will receive quotes daily at 8 AM.`, {
                reply_markup: {
                    keyboard: [[{ text: "💡 Get Motivation Now" }]],
                    resize_keyboard: true
                }
            });

            // Send immediate quote
            sendQuoteNow(ctx);
            console.log(`New subscriber: ${incomingText} (${chatID})`);

        } catch (err) {
            console.error(err);
            ctx.reply("There was an error saving your name. Please try again.");
        }
    }
});

// --- 3. BROADCAST LOGIC ---

async function broadcastQuote() {
    console.log('Starting broadcast...');
    const quote = await fetchQuote();

    // Fetch Active Subscribers
    const { data: subscribers, error } = await supabase
        .from('subscribers')
        .select('chat_id')
        .eq('is_active', true);

    if (error) return console.error('Error fetching subs:', error);

    // Send with Rate Limiting
    for (const sub of subscribers) {
        try {
            console.log(`Sending to ${sub.chat_id}`);
            await bot.telegram.sendMessage(sub.chat_id, quote);
            await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay
        } catch (err) {
            if (err.response && err.response.error_code === 403) {
                console.log(`User ${sub.chat_id} blocked the bot. Deactivating...`);
                await supabase
                    .from('subscribers')
                    .update({ is_active: false })
                    .eq('chat_id', sub.chat_id);
            } else {
                console.error(`Failed to send to ${sub.chat_id}:`, err.message);
            }
        }
    }
    console.log('Broadcast complete.');
}

// --- 4. SCHEDULER ---

cron.schedule('0 8 * * *', () => {
    console.log('Broadcasting quote...');
    broadcastQuote();
}, {
    timezone: "Asia/Kolkata"
});

// --- 5. PRODUCTION SERVER SETUP (CRITICAL FIX) ---

// A. Health Check Route (For UptimeRobot to ping)
app.get('/', (req, res) => {
    res.send('Bot is alive and running!');
});

// B. Dynamic Port (Required for Render/Heroku)
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);

    try {
        // C. Clear Old Webhooks & Start Polling
        // This prevents the "Conflict" error if you ever used webhooks before
        await bot.telegram.deleteWebhook();
        bot.launch();
        console.log('Bot successfully started with Polling!');
    } catch (error) {
        console.error('Failed to start bot:', error);
    }
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));