import type { NextFunction, Request, Response } from "express";
import { createClient } from "./client";
import { prisma } from "./db";

const client = createClient()

export async function middleware(req: Request, res: Response, next: NextFunction) {
    const token = req.headers.authorization

    const data = await client.auth.getUser(token)
    const userId = data.data.user?.id

    if (userId) {
        try {
            await prisma.user.upsert({
                where: { SupabaseId: userId },
                update: {
                    email: data.data.user?.email!,
                },
                create: {
                    id: crypto.randomUUID(),
                    SupabaseId: userId,
                    email: data.data.user?.email!,
                    provider: data.data.user?.app_metadata.provider === "google" ? "Google" : "Github",
                    name: data.data.user?.user_metadata.full_name ?? data.data.user?.email ?? "User"
                }
            })
        } catch(e: any) {
            console.error("User upsert failed:", e.message)
            return res.status(500).json({ message: "User sync failed" })
        }  // ← this closing brace was missing!

        req.userId = userId
        next()
    } else {
        res.status(403).json({ message: "incorrect value" })
    }
}