import {
  AttemptStatus,
  Difficulty,
  ExamStatus,
  MultiScheme,
  PrismaClient,
  QuestionType,
  Role,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";

const prisma = new PrismaClient();

const candidateEmails = Array.from(
  { length: 10 },
  (_, index) => `candidate${index + 1}@exam.test`,
);

function makeOptions(type: QuestionType, index: number) {
  if (type === QuestionType.WRITTEN) {
    return [];
  }

  if (type === QuestionType.MULTI) {
    return [
      { text: `Correct option A${index}`, isCorrect: true, order: 1 },
      { text: `Correct option B${index}`, isCorrect: true, order: 2 },
      { text: `Distractor C${index}`, isCorrect: false, order: 3 },
      { text: `Distractor D${index}`, isCorrect: false, order: 4 },
    ];
  }

  return [
    { text: `Correct option ${index}`, isCorrect: true, order: 1 },
    { text: `Distractor B${index}`, isCorrect: false, order: 2 },
    { text: `Distractor C${index}`, isCorrect: false, order: 3 },
    { text: `Distractor D${index}`, isCorrect: false, order: 4 },
  ];
}

async function upsertUsers() {
  const passwordHashes = await Promise.all([
    bcrypt.hash("Admin@123", 12),
    bcrypt.hash("Exam@123", 12),
    bcrypt.hash("Cand@123", 12),
  ]);

  const admin = await prisma.user.upsert({
    where: { email: "admin@exam.test" },
    update: { name: "Demo Admin", role: Role.ADMIN, active: true },
    create: {
      email: "admin@exam.test",
      name: "Demo Admin",
      passwordHash: passwordHashes[0],
      role: Role.ADMIN,
    },
  });

  const examiner = await prisma.user.upsert({
    where: { email: "examiner@exam.test" },
    update: { name: "Demo Examiner", role: Role.EXAMINER, active: true },
    create: {
      email: "examiner@exam.test",
      name: "Demo Examiner",
      passwordHash: passwordHashes[1],
      role: Role.EXAMINER,
    },
  });

  const candidates = await Promise.all(
    candidateEmails.map((email, index) =>
      prisma.user.upsert({
        where: { email },
        update: { name: `Candidate ${index + 1}`, role: Role.CANDIDATE, active: true },
        create: {
          email,
          name: `Candidate ${index + 1}`,
          passwordHash: passwordHashes[2],
          role: Role.CANDIDATE,
          rollNo: `C-${String(index + 1).padStart(3, "0")}`,
        },
      }),
    ),
  );

  return { admin, examiner, candidates };
}

async function seedQuestions(examinerId: string) {
  const topics = ["Networking", "Databases", "Web Development"];
  const difficulties = [Difficulty.EASY, Difficulty.MEDIUM, Difficulty.HARD];

  for (let index = 1; index <= 30; index += 1) {
    const text = `Seeded ${topics[(index - 1) % topics.length]} question ${index}`;
    const existing = await prisma.question.findFirst({
      where: { createdById: examinerId, text },
      select: { id: true },
    });

    if (existing) {
      continue;
    }

    const type =
      index % 5 === 0
        ? QuestionType.WRITTEN
        : index % 3 === 0
          ? QuestionType.MULTI
          : QuestionType.MCQ;
    const options = makeOptions(type, index);

    await prisma.question.create({
      data: {
        topic: topics[(index - 1) % topics.length],
        difficulty: difficulties[(index - 1) % difficulties.length],
        type,
        text,
        defaultMarks: index % 5 === 0 ? 5 : 2,
        negativeMarks: type === QuestionType.MCQ && index % 4 === 0 ? 0.5 : 0,
        multiScheme: type === QuestionType.MULTI ? MultiScheme.PARTIAL : MultiScheme.ALL_OR_NOTHING,
        createdById: examinerId,
        ...(options.length > 0 ? { options: { create: options } } : {}),
      },
    });
  }

  return prisma.question.findMany({
    where: { createdById: examinerId },
    include: { options: { orderBy: { order: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
}

async function ensureExam({
  title,
  examinerId,
  questions,
  startAt,
  endAt,
  status,
  enrollCandidateIds,
}: {
  title: string;
  examinerId: string;
  questions: Awaited<ReturnType<typeof seedQuestions>>;
  startAt: Date;
  endAt: Date;
  status: ExamStatus;
  enrollCandidateIds: string[];
}) {
  let exam = await prisma.exam.findFirst({
    where: { title, createdById: examinerId },
  });

  if (!exam) {
    const totalMarks = questions.reduce((sum, question) => sum + question.defaultMarks, 0);
    exam = await prisma.exam.create({
      data: {
        title,
        instructions: "This is seeded demo data for the Web-e-Thon examination system.",
        startAt,
        endAt,
        durationMin: 60,
        totalMarks,
        status,
        shuffleQuestions: true,
        shuffleOptions: true,
        createdById: examinerId,
        questions: {
          create: questions.map((question, index) => ({
            questionId: question.id,
            marks: question.defaultMarks,
            order: index + 1,
          })),
        },
      },
    });
  }

  await prisma.enrollment.createMany({
    data: enrollCandidateIds.map((userId) => ({ examId: exam.id, userId })),
    skipDuplicates: true,
  });

  return exam;
}

async function seedCompletedAttempts({
  examId,
  candidates,
  questions,
}: {
  examId: string;
  candidates: { id: string }[];
  questions: Awaited<ReturnType<typeof seedQuestions>>;
}) {
  const completedQuestions = questions.slice(0, 10);

  for (const [candidateIndex, candidate] of candidates.slice(0, 5).entries()) {
    const startedAt = new Date(Date.now() - (candidateIndex + 2) * 86_400_000);
    const submittedAt = new Date(startedAt.getTime() + 42 * 60_000);
    let score = 0;

    const attemptQuestions = completedQuestions.map((question, questionIndex) => {
      const awardedMarks =
        (candidateIndex + questionIndex) % 4 === 0 ? 0 : question.defaultMarks;
      score += awardedMarks;
      const correctOptionIds = question.options
        .filter((option) => option.isCorrect)
        .map((option) => option.id);

      return {
        questionId: question.id,
        order: questionIndex + 1,
        marks: question.defaultMarks,
        snapshot: {
          type: question.type,
          text: question.text,
          topic: question.topic,
          difficulty: question.difficulty,
          negativeMarks: question.negativeMarks,
          multiScheme: question.multiScheme,
          options: question.options.map((option) => ({
            id: option.id,
            text: option.text,
            isCorrect: option.isCorrect,
          })),
        },
        answer: {
          create: {
            response:
              question.type === QuestionType.WRITTEN
                ? { text: "Seeded written response for demo grading." }
                : { optionIds: awardedMarks > 0 ? correctOptionIds : correctOptionIds.slice(0, 1) },
            awardedMarks,
            feedback: question.type === QuestionType.WRITTEN ? "Seeded feedback" : null,
            gradedAt: submittedAt,
          },
        },
      };
    });

    const attempt = await prisma.attempt.upsert({
      where: {
        examId_userId_sandboxRun: {
          examId,
          userId: candidate.id,
          sandboxRun: 0,
        },
      },
      update: {},
      create: {
        examId,
        userId: candidate.id,
        status: AttemptStatus.GRADED,
        startedAt,
        expiresAt: new Date(startedAt.getTime() + 60 * 60_000),
        submittedAt,
        score,
        questions: { create: attemptQuestions },
      },
    });

    const issuedAt = new Date();
    const hash = createHash("sha256")
      .update(`${attempt.id}|${examId}|${score}|${issuedAt.toISOString()}`)
      .digest("hex");

    await prisma.report.upsert({
      where: { attemptId: attempt.id },
      update: {},
      create: {
        attemptId: attempt.id,
        verifyCode: randomBytes(16).toString("hex"),
        hash,
        issuedAt,
      },
    });
  }
}

async function main() {
  const { examiner, candidates } = await upsertUsers();
  const questions = await seedQuestions(examiner.id);
  const now = Date.now();

  await ensureExam({
    title: "Demo Open Exam",
    examinerId: examiner.id,
    questions: questions.slice(0, 15),
    startAt: new Date(now - 60 * 60_000),
    endAt: new Date(now + 2 * 60 * 60_000),
    status: ExamStatus.PUBLISHED,
    enrollCandidateIds: candidates.map((candidate) => candidate.id),
  });

  await ensureExam({
    title: "Demo Draft Exam",
    examinerId: examiner.id,
    questions: questions.slice(15, 20),
    startAt: new Date(now + 24 * 60 * 60_000),
    endAt: new Date(now + 25 * 60 * 60_000),
    status: ExamStatus.DRAFT,
    enrollCandidateIds: [],
  });

  const completedExam = await ensureExam({
    title: "Demo Completed Exam",
    examinerId: examiner.id,
    questions: questions.slice(20, 30),
    startAt: new Date(now - 3 * 24 * 60 * 60_000),
    endAt: new Date(now - 2 * 24 * 60 * 60_000),
    status: ExamStatus.PUBLISHED,
    enrollCandidateIds: candidates.map((candidate) => candidate.id),
  });

  await seedCompletedAttempts({
    examId: completedExam.id,
    candidates,
    questions,
  });

  await prisma.exam.update({
    where: { id: completedExam.id },
    data: { resultsPublishedAt: new Date(now - 24 * 60 * 60_000) },
  });

  console.log("Seeded users, question bank, demo exams, attempts, and reports.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
