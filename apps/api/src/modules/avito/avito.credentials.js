"use strict";

const prisma = require("../../lib/prisma");
const { createClient, getAppAccessToken, getSelfAccount } = require("../../services/avitoClient");

const TOKEN_REFRESH_SKEW_MS = 2 * 60 * 1000;

function isExpiringSoon(expiresAt) {
  if (!expiresAt) return true;
  const ts = new Date(expiresAt).getTime();
  if (!Number.isFinite(ts)) return true;
  return (ts - Date.now()) <= TOKEN_REFRESH_SKEW_MS;
}

async function resolveAccountCredentials(acc) {
  if (!acc) throw new Error("[avito:auth] account is required");

  let accessToken = String(acc.accessToken ?? "").trim();
  let accountId = String(acc.accountId ?? "").trim();
  let accessTokenExpiresAt = acc.accessTokenExpiresAt ?? null;

  const clientId = String(acc.clientId ?? "").trim();
  const clientSecret = String(acc.clientSecret ?? "").trim();
  const hasAppCreds = Boolean(clientId && clientSecret);

  if (hasAppCreds && (!accessToken || isExpiringSoon(accessTokenExpiresAt))) {
    const tokenData = await getAppAccessToken({ clientId, clientSecret });
    accessToken = tokenData.accessToken;
    accessTokenExpiresAt = new Date(Date.now() + Math.max(tokenData.expiresIn - 30, 30) * 1000);
  }

  if (hasAppCreds && (!accountId || !/^\d+$/.test(accountId))) {
    const self = await getSelfAccount(accessToken);
    accountId = self.id;
  }

  if (!accessToken || !accountId) {
    throw new Error("[avito:auth] account has incomplete credentials (need access token + account id)");
  }

  const changed =
    accessToken !== String(acc.accessToken ?? "").trim() ||
    accountId !== String(acc.accountId ?? "").trim() ||
    (
      (accessTokenExpiresAt && !acc.accessTokenExpiresAt) ||
      (!accessTokenExpiresAt && acc.accessTokenExpiresAt) ||
      (accessTokenExpiresAt && acc.accessTokenExpiresAt && new Date(accessTokenExpiresAt).getTime() !== new Date(acc.accessTokenExpiresAt).getTime())
    );

  if (changed) {
    await prisma.avitoAccount.update({
      where: { id: acc.id },
      data: {
        accessToken,
        accountId,
        accessTokenExpiresAt,
      },
    });
  }

  return { accessToken, accountId };
}

async function createClientForAccount(acc) {
  const creds = await resolveAccountCredentials(acc);
  return { client: createClient({ token: creds.accessToken, accountId: creds.accountId }), accountId: creds.accountId };
}

module.exports = { resolveAccountCredentials, createClientForAccount };

