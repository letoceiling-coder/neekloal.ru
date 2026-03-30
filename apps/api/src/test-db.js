"use strict";

require("dotenv").config();
const prisma = require("./lib/prisma");

async function main() {
  const user = await prisma.user.create({
    data: {
      email: "test@test.com",
    },
  });

  console.log("USER CREATED:", user);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
