import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [users, questions, exams, attempts, reports] = await Promise.all([
    prisma.user.count(),
    prisma.question.count(),
    prisma.exam.count(),
    prisma.attempt.count(),
    prisma.report.count(),
  ]);

  console.log(JSON.stringify({ users, questions, exams, attempts, reports }));
}

main().finally(async () => {
  await prisma.$disconnect();
});
