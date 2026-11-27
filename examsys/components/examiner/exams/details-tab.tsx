"use client";

import { ExamForm } from "./exam-form";
import type { ExamTabProps } from "./exam-tabs";
import { Card } from "./ui";

export function DetailsTab({ exam, onExamChange }: Readonly<ExamTabProps>) {
  return (
    <Card title="Details">
      <ExamForm exam={exam} onSaved={onExamChange} />
    </Card>
  );
}
