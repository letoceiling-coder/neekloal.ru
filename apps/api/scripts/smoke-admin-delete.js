#!/usr/bin/env node
/**
 * Smoke: DELETE /admin/users/:id and DELETE /admin/plans/:id return 200 with root JWT.
 * Run from apps/api: node -r dotenv/config scripts/smoke-admin-delete.js
 */
"use strict";

require("dotenv").config();
const http = require("http");
const { PrismaClient } = require("@prisma/client");
const { signAccessToken } = require("../src/lib/jwt");

const prisma = new PrismaClient();

function httpDelete(path, token) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: Number(process.env.PORT) || 4000,
        path,
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  const root = await prisma.user.findFirst({
    where: { role: "root", deletedAt: null },
  });
  const org = await prisma.organization.findFirst({
    where: { deletedAt: null },
  });
  if (!root || !org) {
    console.error("Need at least one root user and one organization");
    process.exit(1);
  }
  const token = signAccessToken({
    userId: root.id,
    organizationId: org.id,
  });

  const victim = await prisma.user.create({
    data: {
      email: `smoke-del-user-${Date.now()}@invalid.local`,
      role: "user",
    },
  });

  const u = await httpDelete(`/admin/users/${victim.id}`, token);
  if (u.status !== 200) {
    console.error("DELETE user expected 200, got", u.status, u.body);
    await prisma.user.delete({ where: { id: victim.id } }).catch(() => {});
    process.exit(1);
  }
  console.log("DELETE /admin/users/:id ->", u.status, u.body.trim());

  const anyPlan = await prisma.plan.findFirst({
    where: { deletedAt: null },
  });
  if (!anyPlan) {
    console.error("No plan");
    process.exit(1);
  }
  const planSlug = `smoke-plan-${Date.now()}`;
  const newPlan = await prisma.plan.create({
    data: {
      slug: planSlug,
      name: "Smoke plan",
      maxRequestsPerMonth: 1,
      maxTokensPerMonth: 1,
      allowedModels: ["*"],
    },
  });

  const p = await httpDelete(`/admin/plans/${newPlan.id}`, token);
  if (p.status !== 200) {
    console.error("DELETE plan expected 200, got", p.status, p.body);
    process.exit(1);
  }
  console.log("DELETE /admin/plans/:id ->", p.status, p.body.trim());

  const gone = await prisma.plan.findUnique({ where: { id: newPlan.id } });
  if (!gone?.deletedAt) {
    console.error("Plan soft-delete not set");
    process.exit(1);
  }
  console.log("OK smoke-admin-delete");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
