"use strict";

const jwt = require("jsonwebtoken");

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (s && String(s).trim() !== "") {
    return String(s).trim();
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is required in production");
  }
  return "dev-insecure-jwt-secret-change-me";
}

/**
 * @param {{ userId: string, organizationId: string }} payload
 * @returns {string}
 */
function signAccessToken(payload) {
  return jwt.sign(
    {
      userId: payload.userId,
      organizationId: payload.organizationId,
    },
    getSecret(),
    { expiresIn: "7d" }
  );
}

/**
 * @param {string} token
 * @returns {{ userId: string, organizationId: string }}
 */
function verifyAccessToken(token) {
  const decoded = jwt.verify(token, getSecret());
  if (typeof decoded !== "object" || decoded == null) {
    throw new Error("Invalid token payload");
  }
  const userId = decoded.userId;
  const organizationId = decoded.organizationId;
  if (typeof userId !== "string" || typeof organizationId !== "string") {
    throw new Error("Invalid token claims");
  }
  return { userId, organizationId };
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
};
