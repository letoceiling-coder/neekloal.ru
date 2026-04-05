require("dotenv").config();
const p = require("./src/lib/prisma");
p.user.findFirst({where:{role:"root"},select:{email:true,id:true}})
  .then(u => { console.log("admin email:", u?.email); process.exit(0); })
  .catch(e => { console.error(e.message); process.exit(1); });
