import type { Metadata } from "next";
import { RoomList } from "@/components/room-list";
import { getPlanPayload } from "@/lib/plan-data.ts";

export const metadata: Metadata = { title: "NextLink · ห้องเรียน" };

export default function RoomsPage() {
  return <RoomList payload={getPlanPayload()} />;
}
