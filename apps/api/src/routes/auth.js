"use strict";

const crypto = require("crypto");
const prisma = require("../lib/prisma");
const { signAccessToken } = require("../lib/jwt");
const { hashPassword, verifyPassword } = require("../lib/password");

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function authRoutes(fastify) {
  fastify.post("/auth/register", async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const email = body.email != null ? String(body.email).trim().toLowerCase() : "";
    const password = body.password != null ? String(body.password) : "";

    if (!email || !email.includes("@")) {
      return reply.code(400).send({ error: "Valid email is required" });
    }
    if (password.length < 8) {
      return reply.code(400).send({ error: "Password must be at least 8 characters" });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(409).send({ error: "Email already registered" });
    }

    const passwordHash = await hashPassword(password);

    let user;
    let organizationId;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: { email, passwordHash },
        });

        const slug = `o-${crypto.randomBytes(6).toString("hex")}`;
        const org = await tx.organization.create({
          data: {
            name: `${email.split("@")[0] || "Workspace"}`,
            slug,
          },
        });

        await tx.membership.create({
          data: {
            userId: u.id,
            organizationId: org.id,
            role: "OWNER",
          },
        });

        return { user: u, organizationId: org.id };
      });

      user = result.user;
      organizationId = result.organizationId;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: "Registration failed" });
    }

    const accessToken = signAccessToken({
      userId: user.id,
      organizationId,
    });

    return reply.code(201).send({
      accessToken,
      user: { id: user.id, email: user.email },
      organizationId,
    });
  });

  fastify.post("/auth/login", async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const email = body.email != null ? String(body.email).trim().toLowerCase() : "";
    const password = body.password != null ? String(body.password) : "";

    if (!email || !password) {
      return reply.code(400).send({ error: "Email and password are required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }
    if (!user.passwordHash) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    const membership = await prisma.membership.findFirst({
      where: { userId: user.id, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });

    if (!membership) {
      return reply.code(403).send({ error: "No organization for this account" });
    }

    const accessToken = signAccessToken({
      userId: user.id,
      organizationId: membership.organizationId,
    });

    return {
      accessToken,
      user: { id: user.id, email: user.email },
      organizationId: membership.organizationId,
    };
  });

  fastify.post("/auth/forgot-password", async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const email = body.email != null ? String(body.email).trim().toLowerCase() : "";

    const generic = { ok: true };

    if (!email) {
      return generic;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt || !user.passwordHash) {
      return generic;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: token,
        passwordResetExpires: expires,
      },
    });

    const base =
      process.env.PASSWORD_RESET_PUBLIC_BASE_URL &&
      String(process.env.PASSWORD_RESET_PUBLIC_BASE_URL).replace(/\/$/, "");
    if (base) {
      const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;
      fastify.log.info({ email, resetLink: link }, "password reset link");
    } else if (process.env.AUTH_DEBUG === "1") {
      fastify.log.warn(
        { email, token, expires },
        "password reset token (AUTH_DEBUG=1; set PASSWORD_RESET_PUBLIC_BASE_URL for link logging)"
      );
    }

    return generic;
  });

  fastify.post("/auth/reset-password", async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const token = body.token != null ? String(body.token).trim() : "";
    const password = body.password != null ? String(body.password) : "";

    if (!token || !password) {
      return reply.code(400).send({ error: "token and password are required" });
    }
    if (password.length < 8) {
      return reply.code(400).send({ error: "Password must be at least 8 characters" });
    }

    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpires: { gt: new Date() },
        deletedAt: null,
      },
    });

    if (!user) {
      return reply.code(400).send({ error: "Invalid or expired token" });
    }

    const passwordHash = await hashPassword(password);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });

    return { ok: true };
  });
};
