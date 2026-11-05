-- Update base url to custom domain pulsewad2.com for review links in automated emails and Telegram
update app_config
   set value = '"https://pulsewad2.com"'
 where key = 'pulse_base_url';

