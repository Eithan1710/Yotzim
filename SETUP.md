# ✨ רעיונות (AI) — הפעלה

## 1. מסד הנתונים
Supabase → SQL Editor → הריצו `supabase-migration-v5.sql` (טבלאות `outing_ratings` ו-`user_prefs`).
האתר ממשיך לעבוד גם לפני זה; פשוט אין דירוגים והעדפות.

## 2. הפונקציה (המפתח של Groq נשאר בצד השרת)
```bash
supabase functions deploy ai-suggest --no-verify-jwt
supabase secrets set GROQ_API_KEY=gsk_...
supabase secrets set APP_PUBLIC_KEY=sb_publishable_...        # אותו מפתח שב-config.js
supabase secrets set ALLOWED_ORIGINS=https://eithan1710.github.io
```
אופציונלי: `TAVILY_API_KEY` (מקור מחקר נוסף), `GROQ_MODEL` (ברירת מחדל `llama-3.3-70b-versatile`),
`GROQ_RESEARCH_MODEL` (ברירת מחדל `groq/compound`, זה שמחפש ברשת).
`--no-verify-jwt` נדרש כי מפתחות `sb_publishable_` אינם JWT. ההגנה: `APP_PUBLIC_KEY` + `ALLOWED_ORIGINS` + הגבלת קצב.

## 3. האתר
מעלים ל-GitHub Pages: `index.html`, `script.js`, `style.css`, `sw.js`, `ai-service.js` (קובץ חדש).
ה-service worker קיבל גרסה חדשה (`yotzim-v4`), אז הטלפונים יתעדכנו לבד.

## עדכונים
הריצו migrations חדשות לפי הסדר (v3 → v4 → v5 → v6) גם על מסד קיים; בטוח להריץ יותר מפעם אחת.
`supabase-migration-v6.sql` מוסיף רשימת ציוד ליציאה, ונועל במסד את מחיקת היציאות שכבר עברו.
