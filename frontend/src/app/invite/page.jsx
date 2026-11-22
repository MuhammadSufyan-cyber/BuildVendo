"use client";
import { Suspense } from "react";
import TokenForm from "../../components/TokenForm";

export default function Page() {
  return <Suspense><TokenForm mode="invite" /></Suspense>;
}
