import express from "express";
import { tavily } from "@tavily/core"
import Groq from "groq-sdk"
import { PROMPT_TEMPLATE, SYSTEM_PROMPT } from "./prompt";
import { middleware } from "./middleware";
import cors from "cors";
import { prisma } from "./db";


const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const client = tavily({ apiKey: process.env.TAVILY_API_KEY });

const app = express()
app.use(express.json())
app.use(cors({
  origin: function (origin, callback) {
    callback(null, origin || "*");
  },
  credentials: true
}))


app.get("/conversations", middleware, async (req, res) => {

    const conversation = await prisma.conversation.findMany({
        where: {
            userId: req.userId!
        }
    })
    res.json(conversation)
})

app.get("/conversations/:conversationId", middleware, async (req, res) => {

    const conversationsId = req.params.conversationId

    try {
        const result = await prisma.conversation.findFirst({
            where: {
                id: conversationsId,
                userId: req.userId!
            },
            include: {
                messages: true
            }
        })
        if (!result) {
            return res.status(404).json({
                message: "conversation not found"
            })
        }
        res.json(result)
    } catch (e) {
        res.status(500).json({
            message: "Failed to fetch conversationId"
        })

    }
})

app.post("/asking_purplexity", middleware, async (req, res) => {
    try {
        const query = req.body.query

        let webSearchResult: any[] = [];
        try {
            const webSearchResponse = await client.search(query, {
                searchDepth: "advanced"
            });
            webSearchResult = webSearchResponse.results;
            console.log("✅ Tavily returned", webSearchResult.length, "results");
        } catch (tavilyErr: any) {
            console.error("❌ Tavily error:", tavilyErr?.message ?? tavilyErr);
        }

        const prompt = PROMPT_TEMPLATE
            .replace("{{WEB_SEARCH_RESULTS}}", JSON.stringify(webSearchResult))
            .replace("{{USER_QUERY}}", query);

        const completion = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: prompt }
            ]
        });

        const answer = completion.choices[0]?.message.content || ""

        const conversation = await prisma.conversation.create({
            data: {
                userId: req.userId!,
                slug: crypto.randomUUID(),
                title: query.slice(0, 100)
            }
        })

        await prisma.message.createMany({
            data: [
                { content: query, role: "User", conversationId: conversation.id },
                { content: answer, role: "Assistant", conversationId: conversation.id }
            ]
        })

        res.write(answer)
        res.write("\n~~~~~~~~~~~~~~~SOURCES~~~~~~~~~~~~~~~~~~~\n")
        webSearchResult.forEach(result => res.write(JSON.stringify(result) + "\n\n"));
        res.write("\n~~~~~~~~~~~~~~~CONVERSATION_ID~~~~~~~~~~~~~~~~~~~\n")
        res.write(conversation.id)
        res.end()
    } catch (e) {
        console.error(e)
        res.status(500).json({ message: "Something went wrong" })
    }
})

app.post("/asking_purplexity/follow_up", middleware, async (req, res) => {
    try {
        const { conversationId, query } = req.body

        // 1. Get existing conversation + all past messages from DB
        const conversation = await prisma.conversation.findFirst({
            where: { id: conversationId, userId: req.userId! },
            include: { messages: true }
        })

        if (!conversation) return res.status(404).json({ message: "conversation not found" })

        // 2. Map DB messages → Groq format
        const messageHistory = conversation.messages.map(msg => ({
            role: msg.role === "User" ? "user" as const : "assistant" as const,
            content: msg.content
        }))

        // 3. Send full history + new question to LLM
        const completion = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                ...messageHistory,
                { role: "user", content: query }
            ]
        })

        const answer = completion.choices[0]?.message.content || ""

        // 4. Save new messages to DB
        await prisma.message.createMany({
            data: [
                { content: query, role: "User", conversationId },
                { content: answer, role: "Assistant", conversationId }
            ]
        })

        // 5. Stream answer back
        res.write(answer)
        res.end()
    } catch (e) {
        console.error(e)
        res.status(500).json({ message: "Something went wrong" })
    }
})

app.listen(3001)