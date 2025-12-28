require('dotenv').config();
const cron = require('node-cron');
const  fetchQuote  = require('./helper/getQuote');
const  supabase  = require('./helper/getSupaBaseClient');
const   bot  = require('./helper/getTelagramBot.js');

// 2. In-Memory State Tracker
// Stores what the user is currently doing. Format: { chat_id: 'WAITING_FOR_NAME' }
const userStates = {};

// --- BOT COMMANDS ---

// 1. Handle /start
bot.start((ctx) => {
    const chatID = ctx.chat.id;
    
    // Set the state for this user to wait for their name
    userStates[chatID] = 'WAITING_FOR_NAME';
    
    ctx.reply("Welcome! 🚀\nTo subscribe to daily motivation, please enter your name:");
});

// 2. Handle /stop (Sign Out)
bot.command('stop', async (ctx) => {
    const chatID = ctx.chat.id;

    try {
        const { error } = await supabase
            .from('subscribers')
            .update({ is_active: false })
            .eq('chat_id', chatID);

        if (error) throw error;

        // Remove the keyboard when they stop so the button goes away
        ctx.reply("You have been unsubscribed. 🔕\nYou won't receive daily quotes anymore.\n\nType /start if you want to join again!", {
            reply_markup: { remove_keyboard: true }
        });
        console.log(`User unsubscribed: ${chatID}`);

    } catch (err) {
        console.error('Error unsubscribing:', err);
        ctx.reply("Something went wrong. Please try again.");
    }
});

// 3. Handle /quote and the Button Click
// We map both the command and the specific text of the button to the same function
const sendQuoteNow = async (ctx) => {
    // Show "typing..." status so user knows bot is working
    ctx.sendChatAction('typing');

    const quote = await fetchQuote();
    ctx.reply(quote);
};

// Listen for the command AND the button text
bot.command('quote', sendQuoteNow);
bot.hears('💡 Get Motivation Now', sendQuoteNow); 


// 4. Handle Text Messages (For Name Input)
bot.on('text', async (ctx) => {
    const chatID = ctx.chat.id;
    const incomingText = ctx.message.text;

    // Check if we are waiting for a name from this user
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

            // B. Confirm and Clear State
            delete userStates[chatID]; // Stop waiting

            // C. Reply with the Interactive Button attached
            ctx.reply(`Thanks ${incomingText}! You are now subscribed. You will receive quotes daily at 8 AM.`, {
                reply_markup: {
                    keyboard: [
                        [{ text: "💡 Get Motivation Now" }] 
                    ],
                    resize_keyboard: true 
                }
            });

            // send quote
            sendQuoteNow(ctx);

            console.log(`New subscriber: ${incomingText} (${chatID})`);

        } catch (err) {
            console.error(err);
            ctx.reply("There was an error saving your name. Please try again.");
        }

    } else {
        // If they send text but we aren't waiting for anything (and it's not a button click)
        // We generally ignore random text or send a help message
        // ctx.reply("I don't understand that command. Try /quote or /stop.");
    }
});


// --- BROADCAST LOGIC ---

async function broadcastQuote() {
    console.log('Starting broadcast...');
    
    // A. Get the quote using our helper
    const quote = await fetchQuote();

    // B. Fetch All Active Subscribers
    const { data: subscribers, error } = await supabase
        .from('subscribers')
        .select('chat_id')
        .eq('is_active', true);

    if (error) return console.error('Error fetching subs:', error);

    // C. Send Messages with Rate Limiting
    for (const sub of subscribers) {
        try {
            await bot.telegram.sendMessage(sub.chat_id, quote);
            await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay
        } catch (err) {
            // Handle Blocked Users (403 Forbidden)
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

// --- SCHEDULER ---

// Schedule the Job (8:00 AM Daily)
cron.schedule('0 8 * * *', () => {
    broadcastQuote();
}, {
    timezone: "Asia/Kolkata"
});

// --- LAUNCH ---

bot.launch();
console.log('Bot is running...');

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));