"use client";

import { createContext, useContext, type ReactNode } from "react";

interface SharedQueryContextValue {
  shareToken: string;
  password?: string;
}

const SharedQueryContext = createContext<SharedQueryContextValue | null>(null);

export function SharedQueryProvider({
  shareToken,
  password,
  children,
}: {
  shareToken: string;
  password?: string;
  children: ReactNode;
}) {
  return (
    <SharedQueryContext.Provider value={{ shareToken, password }}>
      {children}
    </SharedQueryContext.Provider>
  );
}

export function useSharedQueryContext(): SharedQueryContextValue | null {
  return useContext(SharedQueryContext);
}
