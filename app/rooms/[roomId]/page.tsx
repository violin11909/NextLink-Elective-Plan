import { RoomSchedule } from "@/components/room-schedule";
import { getPlanPayload } from "@/lib/plan-data.ts";

export function generateStaticParams() {
  return getPlanPayload().rooms.map((room) => ({ roomId: room.id }));
}

export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <RoomSchedule payload={getPlanPayload()} roomId={roomId} />;
}
