-- Who receives each persona's email and Telegram during the demo.
-- Run in the Supabase SQL Editor after 20261105120000_pulse_demo_recipients.sql,
-- with the placeholders replaced. Keep the real addresses out of git.
-- Re-run or edit any time: changes apply on the next send, with no redeploy.
--
-- Telegram chat ids: add the teammate's username to the TELEGRAM_TEST_HANDLE secret,
-- have them send /start to @pulse_wad2_bot, then this finds their id:
--   select username, chat_id from telegram_test_chats order by 1;
--
-- A null email or chat id means nothing is sent to that persona on that channel.
-- Several personas can share one chat id or one email address.

update demo_recipients set recipient_name = 'Jerica', email = 'jerica.koh.2025@computing.smu.edu.sg',
       telegram_chat_id = (select chat_id from telegram_test_chats where username = 'jerica_koh')
 where persona_key = 'rachel';

update demo_recipients set recipient_name = 'Angel', email = 'angel.low.2025@computing.smu.edu.sg',
       telegram_chat_id = (select chat_id from telegram_test_chats where username = 'angellow365')
 where persona_key = 'marcus';

update demo_recipients set recipient_name = 'Alicia', email = 'alicia.goh.2025@computing.smu.edu.sg',
       telegram_chat_id = (select chat_id from telegram_test_chats where username = 'ahlixia')
 where persona_key = 'darren';

update demo_recipients set recipient_name = 'Sarah', email = 'sa.thang.2023@scis.smu.edu.sg',
       telegram_chat_id = (select chat_id from telegram_test_chats where username = 'tinkerthian')
 where persona_key = 'dev';

update demo_recipients set recipient_name = 'Chloe', email = 'chloe.a.2025@computing.smu.edu.sg',
       telegram_chat_id = (select chat_id from telegram_test_chats where username = 'chloeanggggg')
 where persona_key = 'osl_admin';

-- Check the result. Usernames are lower case; a null chat id means that teammate hasn't sent /start yet.
select persona_label, recipient_name, email, telegram_chat_id, copy_all, active
  from demo_recipients order by 1;
