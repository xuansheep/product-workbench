import { useState } from "react";
import { PRESET_AVATARS, type UserAccount } from "../types/index.js";

const STORAGE_KEY = "workbench_user_account";

function generateDefaultUser(): UserAccount {
  const randomAvatar = PRESET_AVATARS[Math.floor(Math.random() * PRESET_AVATARS.length)];
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  return {
    id: `user-${Date.now()}`,
    name: `成员-${randomSuffix}`,
    avatar: randomAvatar.id,
    role: "成员",
    color: randomAvatar.bg
  };
}

export function useAccount() {
  const [account, setAccountState] = useState<UserAccount>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {
      // ignore
    }
    const def = generateDefaultUser();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(def));
    return def;
  });

  const updateAccount = (updates: Partial<UserAccount>) => {
    setAccountState((prev) => {
      const next = { ...prev, ...updates };
      if (updates.avatar) {
        const found = PRESET_AVATARS.find((a) => a.id === updates.avatar);
        if (found) {
          next.color = found.bg;
        }
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  return {
    account,
    updateAccount,
    presetAvatars: PRESET_AVATARS
  };
}
