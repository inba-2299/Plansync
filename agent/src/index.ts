import express, { Request, Response, NextFunction } from "express";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

app.use(express.json({ limit: "10mb" }));

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin ?? "";
  const allowedList = (process.env.ALLOWED_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim());

  const isAllowed = allowedList.some((a) => {
    if (a === origin) return true;
    if (a.startsWith("https://*.")) {
      const suffix = a.slice("https://*.".length);
      return origin.endsWith(suffix);
    }
    return false;
  });

  if (isAllowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/", (_req: Request, res: Response) => {
  res.type("text/plain").send(
    "Plansync agent backend. POST /agent for streaming, GET /health for status."
  );
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    version: "0.0.1",
    env: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      redis: Boolean(process.env.UPSTASH_REDIS_REST_URL),
      encryption: Boolean(process.env.ENCRYPTION_KEY),
    },
  });
});

app.post("/agent", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const emit = (event: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      emit({ type: "error", message: "ANTHROPIC_API_KEY not set in environment" });
      res.end();
      return;
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const userMessage: string =
      typeof req.body?.userMessage === "string" && req.body.userMessage.length > 0
        ? req.body.userMessage
        : "Say hello to the Plansync agent in one sentence, then call the greet tool with a friendly greeting.";

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: userMessage }],
      tools: [
        {
          name: "greet",
          description: "A fake tool used only to verify the streaming loop works end-to-end.",
          input_schema: {
            type: "object",
            properties: {
              greeting: {
                type: "string",
                description: "A friendly greeting message",
              },
            },
            required: ["greeting"],
          },
        },
      ],
    });

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          emit({
            type: "tool_use_start",
            id: event.content_block.id,
            name: event.content_block.name,
          });
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          emit({ type: "text_delta", text: event.delta.text });
        } else if (event.delta.type === "input_json_delta") {
          emit({ type: "tool_input_delta", partialJson: event.delta.partial_json });
        }
      } else if (event.type === "content_block_stop") {
        emit({ type: "tool_use_end" });
      }
    }

    const final = await stream.finalMessage();
    emit({ type: "done", stopReason: final.stop_reason });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message });
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Plansync agent listening on port ${PORT}`);
});
