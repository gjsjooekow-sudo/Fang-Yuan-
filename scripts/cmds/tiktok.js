const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const API = "https://lyric-search-neon.vercel.app/kshitiz?keyword=";
const CACHE = path.join(__dirname, "tiktok_cache");

async function getStream(url) {
  const res = await axios({
    url,
    method: "GET",
    responseType: "stream",
    timeout: 180000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  });
  return res.data;
}

module.exports = {
  config: {
    name: "tiktok",
    aliases: ["tt"],
    version: "1.2.0",
    author: "Mᴏʜᴀᴍᴍᴀᴅ Aᴋᴀsʜ",
    role: 0,
    countDown: 5,
    category: "media",
    description: {
      en: "Search & download TikTok video"
    },
    guide: {
      en: "{pn} <keyword>"
    }
  },

  onStart: async function ({ api, event, args, commandName }) {
    const query = args.join(" ").trim();
    if (!query) {
      return api.sendMessage(
        "❌ أكتب كلمة البحث!\nمثال: tiktok funny cat",
        event.threadID,
        event.messageID
      );
    }

    api.sendMessage(
      `🔎 جاري البحث في تيك توك...\n🔍 الكلمة: ❝ ${query} ❞`,
      event.threadID,
      event.messageID
    );

    try {
      const res = await axios.get(API + encodeURIComponent(query), {
        timeout: 25000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      });

      let results = res.data;
      if (!Array.isArray(results)) {
        results = results?.data || results?.videos || results?.result || [];
      }
      results = results.slice(0, 6);

      if (!results.length) {
        return api.sendMessage("❌ مفيش فيديوهات!", event.threadID, event.messageID);
      }

      let body = "✨ نتائج تيك توك ✨\n\n";
      const imgs = [];

      for (let i = 0; i < results.length; i++) {
        const v = results[i];
        const title = (v.title || v.desc || "بدون عنوان").slice(0, 50);
        const author = v.author?.unique_id || v.author?.uniqueId || v.author?.nickname || "unknown";
        const duration = v.duration || v.video?.duration || "?";

        body += `${i + 1}️⃣ ${title}\n`;
        body += `👤 @${author}\n`;
        body += `⏱️ ${duration}s\n\n`;

        if (v.cover || v.thumbnail || v.origin_cover) {
          imgs.push(getStream(v.cover || v.thumbnail || v.origin_cover).catch(() => null));
        }
      }

      body += `📥 رد برقم من 1 لـ ${results.length} عشان تحمل الفيديو`;

      const atts = (await Promise.all(imgs)).filter(Boolean);

      api.sendMessage(
        { body, attachment: atts.length ? atts : undefined },
        event.threadID,
        (err, info) => {
          if (err || !info) return;
          global.GoatBot.onReply.set(info.messageID, {
            commandName,
            author: event.senderID,
            messageID: info.messageID,
            results
          });
        },
        event.messageID
      );
    } catch (e) {
      console.error("TikTok Search Error:", e.message);
      api.sendMessage(
        "❌ حصل خطأ في الـ API!\nالـ API ممكن يكون واقف حالياً.\nجرب تاني بعد شوية.",
        event.threadID,
        event.messageID
      );
    }
  },

  onReply: async function ({ api, event, Reply }) {
    const choose = parseInt(event.body.trim());
    if (isNaN(choose)) return;

    const { results, messageID, author } = Reply;

    // بس صاحب الرسالة يقدر يرد
    if (event.senderID !== author) return;

    if (choose < 1 || choose > results.length) {
      return api.sendMessage(
        `❌ رقم غلط!\nاختار من 1 لـ ${results.length}`,
        event.threadID,
        event.messageID
      );
    }

    // حذف رسالة النتائج بأمان
    try {
      if (messageID) await api.unsendMessage(messageID);
    } catch (_) {}

    const video = results[choose - 1];
    const title = video.title || video.desc || "TikTok Video";
    const authorName = video.author?.unique_id || video.author?.uniqueId || video.author?.nickname || "unknown";
    const duration = video.duration || video.video?.duration || "?";
    const videoUrl = video.videoUrl || video.play || video.hdplay || video.wmplay || video.video?.playAddr || video.video?.downloadAddr;

    if (!videoUrl) {
      return api.sendMessage("❌ مفيش رابط تحميل للفيديو ده!", event.threadID, event.messageID);
    }

    await fs.ensureDir(CACHE);

    const safeName = title.slice(0, 25).replace(/[^a-z0-9]/gi, "_") || "tiktok";
    const file = path.join(CACHE, `\( {Date.now()}_ \){safeName}.mp4`);

    api.sendMessage(
      `⏳ جاري التحميل...\n🎬 ${title.slice(0, 60)}`,
      event.threadID,
      event.messageID
    );

    try {
      const res = await axios({
        url: videoUrl,
        method: "GET",
        responseType: "stream",
        timeout: 300000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: "https://www.tiktok.com/"
        }
      });

      const writer = fs.createWriteStream(file);
      res.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
        res.data.on("error", reject);
      });

      await api.sendMessage(
        {
          body:
            `✅ تم التحميل!\n\n` +
            `🎥 ${title.slice(0, 80)}\n` +
            `👤 @${authorName}\n` +
            `⏱️ ${duration}s`,
          attachment: fs.createReadStream(file)
        },
        event.threadID,
        () => {
          fs.unlink(file).catch(() => {});
        }
      );
    } catch (e) {
      console.error("TikTok Download Error:", e.message);
      api.sendMessage("❌ فشل التحميل! جرب فيديو تاني.", event.threadID, event.messageID);
      fs.unlink(file).catch(() => {});
    }
  }
};
