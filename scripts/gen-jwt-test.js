require("dotenv").config({ quiet: true });
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
setTimeout(() => { process.stderr.write("TIMEOUT\n"); process.exit(2); }, 10000);
prisma.membership.findFirst({ where: { deletedAt: null } })
  .then((m) => {
    if (!m) { process.stderr.write("NO_MEMBERSHIP\n"); process.exit(1); }
    const token = jwt.sign(
      { userId: m.userId, organizationId: m.organizationId },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "1h" }
    );
    process.stdout.write(token + "\n");
    process.exit(0);
  })
  .catch((e) => { process.stderr.write(e.message + "\n"); process.exit(1); });
