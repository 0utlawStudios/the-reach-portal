"use client";

import { RawImage } from "@/components/raw-image";
import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { useNavigation } from "@/lib/navigation-context";
import { Sun, Moon, User, Settings, LogOut, ChevronDown, Menu } from "lucide-react";

export function TopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { logout, currentUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { navigate } = useNavigation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <header className="h-12 flex items-center gap-2 px-4 border-b border-gray-100 bg-white dark:bg-[#111] dark:border-white/[0.06] shrink-0">
      {/* Mobile / tablet hamburger */}
      <button onClick={onMenuClick} className="md:hidden p-2 -ml-1 rounded-lg text-gray-500 hover:bg-gray-50 dark:hover:bg-white/[0.06] cursor-pointer transition-colors">
        <Menu className="w-5 h-5" />
      </button>
      <div className="flex-1" />
      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 dark:hover:bg-white/[0.06] dark:hover:text-gray-300 transition-colors cursor-pointer"
        title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      >
        {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
      </button>

      {/* User menu */}
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
        >
          {currentUser.avatar ? (
            <RawImage src={currentUser.avatar} alt={currentUser.name} className="w-7 h-7 rounded-full object-cover" />
          ) : (
            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-bold text-white">
              {currentUser.initials}
            </div>
          )}
          <span className="text-[12px] font-medium text-gray-700 dark:text-gray-300 hidden sm:block">
            {currentUser.name}
          </span>
          <ChevronDown className="w-3 h-3 text-gray-400" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.1] shadow-lg py-1 z-50">
            <div className="px-3 py-2 border-b border-gray-100 dark:border-white/[0.06]">
              <p className="text-[12px] font-medium text-gray-800 dark:text-gray-200">{currentUser.name}</p>
              <p className="text-[10px] text-gray-400">{currentUser.email}</p>
            </div>
            <button onClick={() => { navigate("settings"); setMenuOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.06] transition-colors cursor-pointer">
              <Settings className="w-3.5 h-3.5" /> Settings
            </button>
            <button onClick={() => { navigate("team"); setMenuOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.06] transition-colors cursor-pointer">
              <User className="w-3.5 h-3.5" /> Profile
            </button>
            <div className="border-t border-gray-100 dark:border-white/[0.06] mt-1 pt-1">
              <button onClick={logout} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer">
                <LogOut className="w-3.5 h-3.5" /> Sign Out
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
