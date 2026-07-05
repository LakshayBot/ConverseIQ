"use client";

import {
  HubConnectionBuilder,
  HubConnection,
  LogLevel,
} from "@microsoft/signalr";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

let connection: HubConnection | null = null;

export function getSignalRConnection(): HubConnection {
  if (connection) return connection;

  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  connection = new HubConnectionBuilder()
    .withUrl(`${API_URL}/hubs/meeting`, {
      accessTokenFactory: () => token ?? "",
    })
    .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
    .configureLogging(LogLevel.Warning)
    .build();

  return connection;
}

export async function startConnection(): Promise<HubConnection> {
  const conn = getSignalRConnection();
  if (conn.state === "Connected") return conn;

  try {
    await conn.start();
    console.log("SignalR connected");
  } catch (err) {
    console.error("SignalR connection error:", err);
  }

  return conn;
}

export function stopConnection(): Promise<void> {
  if (connection) {
    return connection.stop();
  }
  return Promise.resolve();
}
