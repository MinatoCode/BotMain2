const axios = require("axios");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream");
const { promisify } = require("util");
const streamPipeline = promisify(pipeline);

module.exports = {
  config: {
    name: "sing",
    aliases: ["s"],
    version: "5.5",
    author: "Lord Denish",
    countDown: 20,
    role: 0,
    shortDescription: { en: "Auto-download songs from YouTube or recognized audio/video" },
    description: "Reply to audio/video or type a search term to download the song as MP3 automatically.",
    category: "🎶 Media",
    guide: { en: "{pn} <song name>\nReply to an audio/video to auto-download." }
  },

  onStart: async function({ api, message, args, event }) {
    if (api.setMessageReaction) api.setMessageReaction("⏳", event.messageID, () => {}, true);

    const safeReply = async (text) => {
      try { await message.reply(text); } catch (e) { console.error("Failed to send reply:", e); }
    };

    let songName;

    try {
      // 1️⃣ Reply recognition
      const attachment = event.messageReply?.attachments?.[0];
      if (attachment && (attachment.type === "audio" || attachment.type === "video")) {
        try {
          const recogUrl = `https://audio-recon-ahcw.onrender.com/kshitiz?url=${encodeURIComponent(attachment.url)}`;
          const { data: recogData } = await axios.get(recogUrl);
          if (recogData?.title) songName = recogData.title;
        } catch (err) {
          console.error("Audio-Recon API failed (silent):", err.response?.data || err.message);
        }
      }

      // 2️⃣ Text fallback
      if (!songName) {
        if (!args.length) {
          if (api.setMessageReaction) api.setMessageReaction("⚠️", event.messageID, () => {}, true);
          return safeReply("⚠️ Provide a song name or reply to audio/video.");
        }
        songName = args.join(" ");
      }

      const startTime = Date.now();

      // 3️⃣ Search API
      let searchResults;
      try {
        const { data } = await axios.get(`https://dns-ruby.vercel.app/search?query=${encodeURIComponent(songName)}`);
        searchResults = data;
      } catch (err) {
        console.error("❌ DNS-Ruby API failed:", err.response?.data || err.message);
        if (api.setMessageReaction) api.setMessageReaction("❌", event.messageID, () => {}, true);
        return safeReply("❌ Search API failed.");
      }

      if (!searchResults?.[0]?.url) {
        console.error("❌ Empty search results:", JSON.stringify(searchResults).slice(0, 500));
        if (api.setMessageReaction) api.setMessageReaction("❌", event.messageID, () => {}, true);
        return safeReply("❌ No results found for this query.");
      }

      const song = searchResults[0];
      const videoUrl = song.url;

      // 4️⃣ Download API
      let downloadData;
      try {
        const { data } = await axios.get(`https://ytmp-f4d4.onrender.com/api/ytdown-mp3?url=${encodeURIComponent(videoUrl)}`);
        downloadData = data;
      } catch (err) {
        console.error("❌ Download API failed:", err.response?.data || err.message);
        if (api.setMessageReaction) api.setMessageReaction("❌", event.messageID, () => {}, true);
        return safeReply("❌ Download API failed.");
      }

      const downloadUrl = downloadData?.download_url || downloadData?.url || downloadData?.link;
      const songTitle = downloadData?.title || song.title || "Unknown";

      if (!downloadUrl || typeof downloadUrl !== "string") {
        console.error("❌ Invalid API response (no download url):", JSON.stringify(downloadData).slice(0, 800));
        if (api.setMessageReaction) api.setMessageReaction("❌", event.messageID, () => {}, true);
        return safeReply("❌ Download API did not return a valid link.");
      }

      const songInfoMessage = `
🎶 *Now Playing*: ${songTitle}  
👀 *Views*: ${song.views || "Unknown"}  
⏳ *Duration*: ${song.timestamp || "Unknown"}  
⚡ *Fetched in*: ${(Date.now() - startTime) / 1000}s  
`;

      // 5️⃣ Download & send
      const tempFileName = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`;
      const tempPath = path.join(__dirname, tempFileName);

      try {
        const audioResponse = await axios({
          method: "get",
          url: downloadUrl,
          responseType: "stream",
          httpsAgent: new https.Agent({ rejectUnauthorized: false }),
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Referer": "https://www.youtube.com/",
            "Accept": "*/*"
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 120000
        });

        if (audioResponse.status !== 200) {
          console.error("❌ Download URL returned non-200:", audioResponse.status, audioResponse.headers);
          if (api.setMessageReaction) api.setMessageReaction("❌", event.messageID, () => {}, true);
          return safeReply(`❌ Download URL returned status ${audioResponse.status}.`);
        }

        await streamPipeline(audioResponse.data, fs.createWriteStream(tempPath));

        await message.reply({ body: songInfoMessage, attachment: fs.createReadStream(tempPath) });

        if (api.setMessageReaction) api.setMessageReaction("✅", event.messageID, () => {}, true);
      } catch (err) {
        console.error("❌ Error while fetching or writing audio stream:", err.message);
        if (api.setMessageReaction) api.setMessageReaction("❌", event.messageID, () => {}, true);
        return safeReply(`❌ Something went wrong while downloading the audio: ${err.message}`);
      } finally {
        try { fs.unlinkSync(tempPath); } catch (e) { /* ignore */ }
      }
    } catch (err) {
      console.error("❌ [Sing Command Error]:", err.stack || err.message || err);
      if (api.setMessageReaction) api.setMessageReaction("❌", event.messageID, () => {}, true);
      return safeReply("❌ Something went wrong while fetching the song. Check the console.");
    }
  }
};
