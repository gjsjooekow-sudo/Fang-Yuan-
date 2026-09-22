const Tiktok = require("@tobyg74/tiktok-api-dl");
const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const CACHE = path.join(__dirname, "tiktok_cache");

async function downloadFile(url, filePath) {
  const res = await axios({
    url,
    method: "GET",
    responseType: "stream",
    timeout: 300000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: "https://www.tiktok.com/"
    }
  });

  const writer = fs.createWriteStream(filePath);
  res.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
    res.data.on("error", reject);
  });
}

async function getCoverStream(url) {
  try {
    const res = await axios({
      url,
      responseType: "stream",
      timeout: 20000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });
    return res.data;
  } catch {
    return null;
  }
}

module.exports = {
  config: {
    name: "tiktok",
    aliases: ["tt"],
    version: "2.0.0",
    author: "Fixed 2026",
    role: 0,
    countDown: 5,
    category: "media",
    description: {
      en: "Search or download TikTok videos (no watermark)"
    },
    guide: {
      en: "{pn} <keyword>\n{pn} <tiktok url>"
    }
  },

  onStart: async function ({ api, event, args, commandName }) {
    const input = args.join(" ").trim();
    if (!input) {
      return api.sendMessage(
        "❌ استخدم الأمر كده:\n\n• بحث: tiktok funny cat\n• رابط: tiktok https://vt.tiktok.com/xxxx",
        event.threadID,
        event.messageID
      );
    }

    // لو الرابط → تحميل مباشر
    const isUrl = /tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com/i.test(input);
    if (isUrl) {
      return handleDownloadByUrl(api, event, input);
    }

    // بحث بالكلمة
    api.sendMessage(
      `🔎 جاري البحث عن: ❝ ${input} ❞\nانتظر شوية...`,
      event.threadID,
      event.messageID
    );

    try {
      const search = await Tiktok.Search(input, {
        type: "video",
        page: 1
      });

      if (!search || search.status !== "success" || !search.result || !search.result.length) {
        return api.sendMessage("❌ مفيش نتائج للبحث ده.", event.threadID, event.messageID);
      }

      const results = search.result.slice(0, 6);
      let body = "✨ نتائج تيك توك ✨\n\n";
      const covers = [];

      results.forEach((v, i) => {
        const title = (v.desc || v.title || "بدون عنوان").slice(0, 55);
        const author = v.author?.unique_id || v.author?.nickname || "unknown";
        body += `${i + 1}️⃣ \( {title}\n👤 @ \){author}\n\n`;
        if (v.cover || v.video?.cover) {
          covers.push(getCoverStream(v.cover || v.video.cover));
        }
      });

      body += `📥 رد برقم من 1 إلى ${results.length} عشان تحمل الفيديو`;

      const atts = (await Promise.all(covers)).filter(Boolean);

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
      console.error("TikTok Search Error:", e?.message || e);
      api.sendMessage(
        "❌ فشل البحث. جرب كلمة تانية أو ابعت رابط الفيديو مباشرة.",
        event.threadID,
        event.messageID
      );
    }
  },

  onReply: async function ({ api, event, Reply }) {
    const choose = parseInt(String(event.body).trim());
    if (isNaN(choose)) return;

    const { results, messageID, author } = Reply;
    if (event.senderID !== author) return;

    if (choose < 1 || choose > results.length) {
      return api.sendMessage(
        `❌ رقم غلط. اختار من 1 إلى ${results.length}`,
        event.threadID,
        event.messageID
      );
    }

    try {
      if (messageID) await api.unsendMessage(messageID);
    } catch (_) {}

    const item = results[choose - 1];
    // نبني رابط الفيديو من الـ id لو موجود
    const videoUrl =
      item.video?.playAddr ||
      item.video?.downloadAddr ||
      item.play ||
      item.hdplay ||
      (item.id
        ? `https://www.tiktok.com/@\( {item.author?.unique_id || "user"}/video/ \){item.id}`
        : null);

    if (!videoUrl) {
      return api.sendMessage("❌ مفيش رابط تحميل للفيديو ده.", event.threadID, event.messageID);
    }

    // لو لسه مش رابط كامل نستخدم Downloader
    const isDirect = /\.mp4|tiktokcdn|byteoversea|musical/i.test(videoUrl);
    if (isDirect) {
      return sendVideoFile(api, event, videoUrl, item.desc || item.title || "TikTok", item.author?.unique_id || "unknown");
    }

    return handleDownloadByUrl(api, event, videoUrl, item);
  }
};

async function handleDownloadByUrl(api, event, url, meta = null) {
  api.sendMessage("⏳ جاري التحميل بدون علامة مائية...", event.threadID, event.messageID);

  try {
    // نجرب 3 إصدارات من المكتبة
    let data = null;
    for (const ver of ["v3", "v2", "v1"]) {
      try {
        const res = await Tiktok.Downloader(url, { version: ver });
        if (res?.status === "success" && res.result) {
          data = res.result;
          break;
        }
      } catch (_) {}
    }

    if (!data) {
      return api.sendMessage("❌ فشل استخراج الفيديو. جرب رابط تاني.", event.threadID, event.messageID);
    }

    const videoUrl =
      data.videoHD ||
      data.video ||
      data.videoWatermark ||
      data.download?.url ||
      data.media?.[0]?.url;

    if (!videoUrl) {
      return api.sendMessage("❌ مفيش رابط فيديو صالح.", event.threadID, event.messageID);
    }

    const title = meta?.desc || meta?.title || data.desc || data.title || "TikTok Video";
    const author =
      meta?.author?.unique_id ||
      data.author?.unique_id ||
      data.author?.nickname ||
      "unknown";

    await sendVideoFile(api, event, videoUrl, title, author);
  } catch (e) {
    console.error("Download Error:", e?.message || e);
    api.sendMessage("❌ حصل خطأ أثناء التحميل.", event.threadID, event.messageID);
  }
}

async function sendVideoFile(api, event, videoUrl, title, author) {
  await fs.ensureDir(CACHE);
  const file = path.join(CACHE, `${Date.now()}.mp4`);

  try {
    await downloadFile(videoUrl, file);

    await api.sendMessage(
      {
        body:
          `✅ تم التحميل!\n\n` +
          `🎥 ${(title || "").slice(0, 80)}\n` +
          `👤 @${author}`,
        attachment: fs.createReadStream(file)
      },
      event.threadID,
      () => fs.unlink(file).catch(() => {})
    );
  } catch (e) {
    console.error("Send file error:", e?.message || e);
    api.sendMessage("❌ فشل إرسال الفيديو (ممكن كبير جدًا).", event.threadID, event.messageID);
    fs.unlink(file).catch(() => {});
  }
         }
