const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const CACHE = path.join(__dirname, "tiktok_cache");

const headers = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://www.tiktok.com/"
};

async function getStream(url) {
  const res = await axios({
    url,
    method: "GET",
    responseType: "stream",
    timeout: 300000,
    headers
  });
  return res.data;
}

async function resolveTikTok(url) {
  // مصادر متعددة لاستخراج الفيديو
  const apis = [
    `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`,
    `https://tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`,
    `https://tdownv4.sl-bjs.workers.dev/?down=${encodeURIComponent(url)}`
  ];

  for (const api of apis) {
    try {
      const { data } = await axios.get(api, { timeout: 25000, headers });

      // شكل tikwm
      if (data?.code === 0 && data?.data) {
        const d = data.data;
        return {
          title: d.title || "TikTok Video",
          author: d.author?.unique_id || d.author?.nickname || "unknown",
          cover: d.cover || d.origin_cover,
          video: d.hdplay || d.play || d.wmplay,
          duration: d.duration
        };
      }

      // شكل tdown
      if (data?.download_url || data?.video) {
        return {
          title: data.title || "TikTok Video",
          author: data.author?.username || data.author?.nickname || "unknown",
          cover: data.author?.avatar || null,
          video: data.download_url || data.video,
          duration: data.author?.duration
        };
      }
    } catch (_) {}
  }
  return null;
}

module.exports = {
  config: {
    name: "tiktok",
    aliases: ["tt"],
    version: "2.1.0",
    author: "Fixed 2026",
    role: 0,
    countDown: 5,
    category: "media",
    description: {
      en: "Download TikTok video without watermark (by URL)"
    },
    guide: {
      en: "{pn} <tiktok url>"
    }
  },

  onStart: async function ({ api, event, args }) {
    const input = args.join(" ").trim();

    if (!input) {
      return api.sendMessage(
        "❌ أرسل رابط تيك توك:\n\nمثال:\ntiktok https://vt.tiktok.com/xxxx",
        event.threadID,
        event.messageID
      );
    }

    const isUrl = /tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com/i.test(input);
    if (!isUrl) {
      return api.sendMessage(
        "❌ هذا الأمر يدعم الروابط فقط حاليًا.\nأرسل رابط فيديو تيك توك.",
        event.threadID,
        event.messageID
      );
    }

    api.sendMessage("⏳ جاري التحميل...", event.threadID, event.messageID);

    try {
      const info = await resolveTikTok(input);
      if (!info || !info.video) {
        return api.sendMessage(
          "❌ فشل استخراج الفيديو. جرّب رابط آخر أو رابط كامل من التطبيق.",
          event.threadID,
          event.messageID
        );
      }

      await fs.ensureDir(CACHE);
      const file = path.join(CACHE, `${Date.now()}.mp4`);

      const stream = await getStream(info.video);
      const writer = fs.createWriteStream(file);
      stream.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
        stream.on("error", reject);
      });

      await api.sendMessage(
        {
          body:
            `✅ تم التحميل!\n\n` +
            `🎥 ${(info.title || "").slice(0, 80)}\n` +
            `👤 @${info.author}` +
            (info.duration ? `\n⏱️ ${info.duration}s` : ""),
          attachment: fs.createReadStream(file)
        },
        event.threadID,
        () => fs.unlink(file).catch(() => {})
      );
    } catch (e) {
      console.error("TikTok Error:", e?.message || e);
      api.sendMessage("❌ حصل خطأ أثناء التحميل.", event.threadID, event.messageID);
    }
  }
};
