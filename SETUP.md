# ✨ רעיונות (AI) + הרשאות מאובטחות — הפעלה

## 0. חשוב מאוד: הפעלת Anonymous Auth (חובה, לפני migration v7!)
הגרסה הזו עוברת ממודל "שם בלבד" למודל הרשאות אמיתי שנאכף בשרת (RLS), ולכן כל מכשיר
צריך session אמיתי מול Supabase Auth.

Supabase Dashboard → **Authentication → Providers → Anonymous** → הפעילו **Allow anonymous sign-ins**.

בלי זה: אחרי הרצת migration v7 שום קריאה למסד לא תעבוד (האפליקציה תיתקע במסך הכניסה),
כי ה-RLS החדש דורש `auth.uid()` תקין ואין דרך אחרת לקבל אותו.

## 1. מסד הנתונים
Supabase → SQL Editor → הריצו migrations לפי הסדר על מסד קיים (בטוח להריץ כל אחת יותר מפעם אחת, הן אידמפוטנטיות):

```
supabase-migration-v3.sql
supabase-migration-v4.sql
supabase-migration-v5.sql
supabase-migration-v6.sql
supabase-migration-v7.sql   ← חדש בגרסה הזו
```

**`supabase-migration-v7.sql`** היא המשמעותית ביותר עד כה. היא:
* יוצרת/מעדכנת טבלת `profiles` (שם ↔ `auth.uid()`, תמונת פרופיל, קוד שחזור).
* יוצרת את פיצ'ר הקבוצות: `groups`, `group_members`, `event_groups`, ועמודת `events.is_private`.
* מגדירה פונקציות עזר (`current_name()`, `can_see_event()`, `is_group_member()`) ומשכתבת **מחדש את כל מדיניות
  ה-RLS** של הטבלאות הקיימות כך שהן נאכפות לפי `auth.uid()` ולא לפי מה שהלקוח טוען שהוא — כולל: מי יכול
  לראות יציאה פרטית של קבוצה, מי יכול לערוך יציאה (כל מי שיכול להשתתף), ומי יכול למחוק אותה (**רק היוצר**,
  ורק כל עוד היא לא עברה).
* מבטלת גישה ישירה של תפקיד `anon` לטבלאות (`revoke ... from anon`) — מעכשיו כל בקשה חייבת session מאומת,
  גם אם אנונימי.
* יוצרת/מעדכנת bucket בשם `avatars` ב-Storage (ציבורי לקריאה, כתיבה רק לבעל המכשיר) לתמונות פרופיל.
* מוסיפה RPCs מאובטחות (SECURITY DEFINER): `claim_profile`, `rename_profile`, `recover_profile`,
  `set_avatar`, `clear_avatar`, `create_group`, `join_group`, `leave_group`, `group_preview`,
  `claim_equipment`, `unclaim_equipment` ועוד.

## 2. הפונקציה (המפתח של Groq נשאר בצד השרת)
```bash
supabase functions deploy ai-suggest --no-verify-jwt
supabase secrets set GROQ_API_KEY=gsk_...
supabase secrets set APP_PUBLIC_KEY=sb_publishable_...        # אותו מפתח שב-config.js
supabase secrets set ALLOWED_ORIGINS=https://eithan1710.github.io
```
אופציונלי: `TAVILY_API_KEY` (מקור מחקר נוסף), `GROQ_MODEL` (ברירת מחדל `openai/gpt-oss-120b`),
`GROQ_RESEARCH_MODEL` (ברירת מחדל `openai/gpt-oss-120b`, זה שמחפש ברשת עם כלי `browser_search`).
`--no-verify-jwt` נדרש כי מפתחות `sb_publishable_` אינם JWT. ההגנה: `APP_PUBLIC_KEY` + `ALLOWED_ORIGINS` + הגבלת קצב.

> ⚠️ המודלים הישנים (`llama-3.3-70b-versatile`, `groq/compound`, `groq/compound-mini`) הוצאו משימוש ע"י
> Groq. הפונקציה עודכנה לעבוד מול `openai/gpt-oss-120b` (עם כלי החיפוש המובנה `browser_search`).
> אם הגדרתם `GROQ_MODEL`/`GROQ_RESEARCH_MODEL` ידנית ב-secrets לערך ישן — עדכנו אותם או מחקו כדי לחזור לברירת המחדל.

## 3. האתר
מעלים ל-GitHub Pages את כל התיקייה, בפרט: `index.html`, `script.js`, `style.css`, `sw.js`, `ai-service.js`, `config.js`.
ה-service worker קיבל גרסה חדשה (`yotzim-v5`), אז הטלפונים יתעדכנו לבד (נדרש רענון אחד).

## 4. אחרי הפריסה — בדיקה מהירה
1. פתחו את האתר במכשיר חדש (או פרטי/incognito) ווודאו שהכניסה עובדת (לא נתקע במסך הכניסה — אם כן, בדקו שוב את
   שלב 0).
2. צרו יציאה, הצטרפו אליה, דרגו אותה — ווודאו שמופיעה הודעת אישור ברורה בכל אחת מהפעולות.
3. פתחו את הפרופיל ("מי אני") והעלו תמונת פרופיל; ודאו שהיא מופיעה בכרטיסי המשתתפים.
4. צרו קבוצה, שתפו את הקישור (מוודג'ט השיתוף/WhatsApp), פתחו אותו ממכשיר/דפדפן אחר ווודאו שההצטרפות עובדת.
5. צרו יציאה ששייכת לקבוצה בלבד, ווודאו שמשתמש שאינו חבר בקבוצה לא רואה אותה כלל (גם לא דרך קריאת API ישירה
   ל-`/rest/v1/events`).
6. ודאו שמשתמש שאינו היוצר יכול לערוך יציאה/ציוד, אך לא רואה כפתור מחיקה — ושגם קריאת `DELETE` ישירה ל-API
   על יציאה שלא הוא יצר נכשלת (0 שורות הושפעו).
7. נסו את "רעיונות ל-AI" ווודאו שההמלצות קרובות לתאריך הנוכחי כברירת מחדל, אך מכבדות בקשה מפורשת כמו
   "בעוד חודש"; לחצו "מידע נוסף" על המלצה ספציפית וודאו שהמידע מתייחס לאותה יציאה בדיוק (לא לאתר כללי).

## הערות/הנחות
* מודל ההרשאות מניח שכל מכשיר = משתמש אחד (session אנונימי אחד); "שחזור שם" (Recovery Code) הוא הדרך
  להעביר זהות למכשיר חדש אם ה-session המקומי אבד.
* יציאות ציבוריות קיימות (`is_private=false`) ממשיכות להיות גלויות לכולם כמו קודם — לא בוצע migration
  שהופך יציאות ישנות לפרטיות.
