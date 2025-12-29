const { default: axios } = require("axios");

async function fetchQuote() {
    try {
        console.log(`fetching quote..`);
        const response = await axios.get('https://zenquotes.io/api/random');
        // ZenQuotes returns an array [ { q: "...", a: "..." } ]
        
        return `"${response.data[0].q}"\n\n- ${response.data[0].a}`;
    } catch (err) {
        console.error('API Error:', err);
        return "Keep pushing forward! (Could not fetch new quote currently).";
    }
}

module.exports = fetchQuote