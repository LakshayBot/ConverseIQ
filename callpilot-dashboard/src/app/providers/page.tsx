"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";

interface Provider {
  id: string;
  provider: string;
  model: string;
  endpoint?: string;
}

export default function ProvidersPage() {
  const { isAuthenticated, logout } = useAuth();
  const router = useRouter();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState("DeepSeek");
  const [model, setModel] = useState("deepseek-chat");
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }
    api.providers.list().then(setProviders).catch(console.error);
  }, [isAuthenticated, router]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.providers.create({
        provider,
        model,
        endpoint: endpoint || null,
        apiKey,
        temperature: 0.2,
        maxTokens: 4096,
        timeout: 30,
        capabilities: "Chat",
      });
      setApiKey("");
      const updated = await api.providers.list();
      setProviders(updated);
    } catch (err) {
      console.error("Failed to save provider", err);
    }
  };

  const deleteProvider = async (id: string) => {
    try {
      await api.providers.delete(id);
      setProviders((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error("Failed to delete provider", err);
    }
  };

  return (
    <main>
      <nav>
        <h2>CallPilot AI</h2>
        <div>
          <a href="/meetings">Meetings</a>
          <a href="/providers">Providers</a>
          <button onClick={logout}>Sign Out</button>
        </div>
      </nav>
      <div>
        <h1>AI Providers</h1>
        <form onSubmit={handleSubmit}>
          <div>
            <label>Provider</label>
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option>DeepSeek</option>
              <option>Ollama</option>
              <option>OpenAI</option>
              <option>Claude</option>
              <option>Gemini</option>
            </select>
          </div>
          <div>
            <label>Model</label>
            <input value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div>
            <label>Endpoint</label>
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="http://localhost:11434"
            />
          </div>
          <div>
            <label>API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <button type="submit">Save Provider</button>
        </form>
        <h2>Configured Providers</h2>
        <ul>
          {providers.map((p) => (
            <li key={p.id}>
              {p.provider} - {p.model}
              <button onClick={() => deleteProvider(p.id)}>Delete</button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
