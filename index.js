require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");

// NEW: Ad-Blocker setup
const puppeteer = require("puppeteer-extra");
const AdblockerPlugin = require("puppeteer-extra-plugin-adblocker");
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

const bot = new Telegraf(process.env.BOT_TOKEN);
const userSessions = new Map();

bot.catch((err, ctx) => console.error(`[Bot Error]`, err));

bot.start((ctx) => ctx.reply("Welcome! Send me a link to get started."));

const step1Menu = Markup.inlineKeyboard([
  Markup.button.callback("📱 Mobile", "view_mobile"),
  Markup.button.callback("🖥️ Desktop", "view_desktop"),
]);

bot.on("text", async (ctx) => {
  const url = ctx.message.text.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return ctx.reply(
      "Please send a valid URL starting with http:// or https://",
    );
  }
  userSessions.set(ctx.from.id, { url: url });
  await ctx.reply("Step 1: Choose the view type", step1Menu);
});

bot.action("back_to_view", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText("Step 1: Choose the view type", step1Menu);
});

bot.action(["view_mobile", "view_desktop"], async (ctx) => {
  await ctx.answerCbQuery();
  const session = userSessions.get(ctx.from.id);
  if (!session) return ctx.reply("Session expired. Please send the URL again.");

  session.view = ctx.match[0];
  userSessions.set(ctx.from.id, session);

  await ctx.editMessageText(
    "Step 2: Choose the output format",
    Markup.inlineKeyboard([
      [
        Markup.button.callback("🖼️ Image", "format_image"),
        Markup.button.callback("📄 PDF", "format_pdf"),
      ],
      [Markup.button.callback("🔙 Back", "back_to_view")],
    ]),
  );
});

bot.action(["format_image", "format_pdf"], async (ctx) => {
  await ctx.answerCbQuery();
  const session = userSessions.get(ctx.from.id);
  if (!session || !session.url || !session.view) {
    return ctx.reply("Session expired. Please send the URL again.");
  }

  const url = session.url;
  const isMobileRequest = session.view === "view_mobile";
  const isPdfRequest = ctx.match[0] === "format_pdf";
  const messageId = ctx.callbackQuery.message.message_id;

  await ctx.editMessageText(
    "⏳ Rendering the page without ads, please wait...",
  );

  (async () => {
    let browser;
    try {
      // Because we use puppeteer-extra, the adblocker is automatically applied here
      browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      const page = await browser.newPage();

      if (isMobileRequest) {
        await page.setViewport({
          width: 375,
          height: 812,
          isMobile: true,
          hasTouch: true,
        });
        await page.setUserAgent(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
        );
      } else {
        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        );
      }

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let totalHeight = 0;
          const distance = 400;
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;
            if (totalHeight >= scrollHeight) {
              clearInterval(timer);
              window.scrollTo(0, 0);
              resolve();
            }
          }, 100);
        });
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const pageHeight = await page.evaluate(
        () => document.documentElement.scrollHeight,
      );
      if (!isPdfRequest && pageHeight > 8000) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          messageId,
          undefined,
          "⚠️ This website is too long for a single image. Please download it as a PDF instead.",
          Markup.inlineKeyboard([
            [Markup.button.callback("📄 Download as PDF", "format_pdf")],
            [Markup.button.callback("🔙 Back", "back_to_view")],
          ]),
        );
        return;
      }

      if (isPdfRequest) {
        const pdfData = await page.pdf({ format: "A4", printBackground: true });
        await ctx.replyWithDocument({
          source: Buffer.from(pdfData),
          filename: `WebSnap_${isMobileRequest ? "Mobile" : "Desktop"}.pdf`,
        });
      } else {
        const screenshotBuffer = await page.screenshot({ fullPage: true });
        await ctx.replyWithPhoto({ source: screenshotBuffer });
      }

      await ctx.deleteMessage(messageId).catch(() => {});
      await ctx.reply(
        "✅ Clean file sent! Send another link whenever you are ready.",
      );
      userSessions.delete(ctx.from.id);
    } catch (error) {
      console.error(error);
      await ctx
        .reply("❌ Sorry, the site took too long or the link is broken.")
        .catch(() => {});
      await ctx.deleteMessage(messageId).catch(() => {});
    } finally {
      if (browser) await browser.close();
    }
  })();
});

bot.launch();
console.log("WebSnap Bot is running with Ad-Blocker...");
