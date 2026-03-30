"use strict";

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {object} p
 * @param {string} p.adminId
 * @param {string} p.action
 * @param {string} p.entity
 * @param {string} p.entityId
 * @param {unknown} [p.payload]
 */
async function appendAdminAudit(tx, p) {
  await tx.adminAuditLog.create({
    data: {
      adminId: p.adminId,
      action: p.action,
      entity: p.entity,
      entityId: p.entityId,
      payload: p.payload == null ? {} : p.payload,
    },
  });
}

module.exports = { appendAdminAudit };
