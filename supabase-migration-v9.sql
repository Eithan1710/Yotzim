-- יוצאים? — שדרוג v9: שמירת מקורות ה-AI על היציאה עצמה (נפרד מ"מי יצר")
-- Supabase → SQL Editor → New query → הדביקו את כל הקובץ → Run
--
-- מה משתנה:
--   * events: עמודה חדשה ai_sources (jsonb, אופציונלית) - כשיציאה נוצרת מתוך רעיון AI, האתר שומר שם
--     את המקורות האמיתיים שה-AI ציטט (sources[], event_url, event_quote - אותה צורה בדיוק שכבר
--     משמשת את מסך ההצעות, בלי מערכת מקבילה). ליציאה שנוצרה ישירות ע"י משתמש, העמודה נשארת null -
--     ולכן לא מוצג אזור "מקורות" כלל, לעולם לא קישור מומצא.
--   * created_by הקיימת כבר, ללא שינוי, היא "מי יצר את היציאה" - תמיד בן אדם אמיתי, גם כשהרעיון הגיע מ-AI.

begin;

alter table events add column if not exists ai_sources jsonb;

-- הגנה בסיסית מפני נתון מעוות: אם יש ערך, הוא חייב להיות אובייקט JSON (לא מחרוזת/מערך/מספר)
alter table events drop constraint if exists events_ai_sources_shape;
alter table events add constraint events_ai_sources_shape
  check (ai_sources is null or jsonb_typeof(ai_sources) = 'object');

commit;

notify pgrst, 'reload schema';
