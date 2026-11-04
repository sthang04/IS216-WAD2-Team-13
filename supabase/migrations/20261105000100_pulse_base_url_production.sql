-- Update base url to Vercel production deployment for review links in automated emails and Telegram
update app_config
   set value = '"https://is-216-wad-2-team-13.vercel.app"'
 where key = 'pulse_base_url';
