# Hangout — контекст для нової сесії

TG Mini App координатор зустрічей друзів. `~/SideProjects/hangout`, `miniapp/` (React+telegram-ui+Supabase) + `supabase/` (Postgres migrations + Deno edge functions).

## Не задеплоєно (треба прогнати перед тестуванням)
```
supabase db push
supabase functions deploy auth notify-event notify-new-event notify-promotions bot
```
Міграції в черзі, від старих до нових:
- `20260711000000_promo_notify.sql` — promo_pending прапорець на rsvps
- `20260711100000_join_space_by_event.sql` — join по event_id (глибокі лінки)
- `20260711200000_settings_promotions.sql` — notify_reminders→notify_promotions
- `20260711300000_member_avatar.sql` — members.avatar_url (застаріла, дивись нижче)
- `20260712000000_join_space_avatar.sql` — застаріла, суперсідиться наступною
- `20260712100000_profiles_refactor.sql` — **головна**: нова таблиця `profiles` (PK=auth.users.id, anchor), `members` більше не дублює first_name/username/avatar_url, `user_settings` тепер PK=profile_id (не tg_user_id)

## Поточна модель ідентичності (після рефакторингу)
```
auth.users → profiles (id=auth uid, tg_user_id unique, first_name/username/avatar_url)
                ↓ FK tg_user_id, on delete cascade
             members (тільки space_id + tg_user_id, без дублювання профілю)
                ↓ shared PK
             user_settings (profile_id PK, notify_new_events, notify_promotions)
```
RLS не чіпали — уся логіка (`tg_uid()`, `is_self()`, `is_space_member()`) як була на bigint tg_user_id з JWT app_metadata, так і лишилась. `get_user_settings()`/`save_user_settings()` — RPC, клієнт не знає uuid профілю.

## Що зроблено цієї сесії
- Глибокі лінки на конкретний івент (`?startapp=e_<id>` / `s_<id>`)
- Налаштування сповіщень: "Нові івенти" (off за замовч, opt-in DM) і "Вихід з черги" (on за замовч, DM при промоушені з черги)
- Аватарки з Telegram (photo_url) в списках користувачів
- Роздільник "У черзі · N" в списку "Хто йде"
- Підсвітка лідера голосування (заливка кольором, не рамка — рамка "кидається в очі")
- Кнопка "Повторити" на завершеному івенті (без копіювання дати)
- DateTimeField: два `<select>` (день/час) замість `datetime-local` — той був ненадійний на десктопі (фантомні дати, дублі, авто-вибір)
- Автооновлення відкритого івенту: додано `visibilitychange`/`focus` слухачі, бо голий `setInterval` тротлиться в фонових вкладках/вікнах на десктопі

## Невирішено
- **Мапи-лінк на десктопі Telegram**: 3 спроби фіксу не спрацювали (capture-phase interception, platform-aware openLink bypass, CSS grid overlay). Фінальне рішення — **просто ховаємо іконку на десктопних клієнтах** (`mapsLinkVisible()` в `lib/links.ts`, дозволяє лише ios/android/android_x). Якщо повернешся до цього — не витрачай час на event-phase трюки, я вже перевірив що `Cell`/`Tappable` з tgui з'їдає клік ще до React-обробників навіть у capture-фазі; єдиний робочий шлях — забрати елемент з DOM-піддерева `Cell`, і то непідтверджено на реальному Windows-клієнті.
- Бот `/start` кнопка відкриває чат замість міні-апки (обговорювали, не чіпали — можливо налаштування BotFather)
- Мобільна клавіатура ховає кнопки лише частково (ontouchstart-хак, користувач підтвердив що на Windows тач все одно тригериться)

## Важливі граблі (щоб не наступати знову)
- `Cell Component="label"` + вкладений клікабельний елемент у `after` = клік реєструється як тогл чекбокса на Windows. `stopPropagation`/`preventDefault` навіть у capture-фазі не рятує — це специфічна tgui-поведінка, підтверджена емпірично двічі в цьому проєкті (раніше: видалення гостя, зараз: мапи-лінк).
- Не пропонуй "плоский div замість Cell" без попередження — користувач вважає це візуально гіршим за нативний tgui-вигляд, навіть якщо функціонально коректно.
- `datetime-local` інпут ненадійний у продакшн-desktop-контексті Telegram — тримайся `<select>`-підходу.
- Dev-перевірка: немає git-репозиторію (не ініціалізовано), тому "відкотити" = вручну переписати код, а не git revert.
