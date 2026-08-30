# Web Push em produção

## Arquitetura

1. O usuário ativa notificações em **Configurações > Notificações**.
2. O navegador cria uma PushSubscription vinculada ao usuário, workspace e dispositivo.
3. O Supabase guarda a subscription em push_subscriptions, protegida por RLS.
4. O cron do Cloudflare Worker chama send-push a cada 15 minutos.
5. A Edge Function lê os dados sincronizados de transações, orçamentos e metas, respeita notification_preferences, evita duplicações com notification_deliveries e envia via Web Push.
6. O Service Worker recebe push e chama showNotification, sem depender da página aberta.

## Preparação

Gere um par VAPID em ambiente administrativo (por exemplo, com npx web-push generate-vapid-keys). Nunca publique a chave privada.

Execute supabase/schema.sql no SQL Editor e depois publique a função usando a CLI do Supabase com a opção --no-verify-jwt. Configure nela os secrets VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_CRON_SECRET e SUPABASE_SERVICE_ROLE_KEY.

Configure no frontend/build:

- NEXT_PUBLIC_VAPID_PUBLIC_KEY: chave pública VAPID.

Configure como secrets do Cloudflare Worker:

- SUPABASE_PUSH_FUNCTION_URL: URL da função send-push.
- PUSH_CRON_SECRET: o mesmo segredo aleatório configurado na Edge Function.

O cron já está definido como */15 * * * * no artefato Wrangler.

## Teste de envio

A função pode ser chamada manualmente via POST, passando Authorization: Bearer seguido do PUSH_CRON_SECRET. O segredo deve ser usado somente no terminal ou servidor.

Teste em HTTPS com usuário autenticado e PWA instalada. Fechar a janela/PWA permite Web Push; usar **Forçar parada** no Chrome/PWA ou bloquear notificações no Android pode impedir entregas até o aplicativo/navegador ser reaberto.

## Rotas

Os payloads abrem a área relacionada usando /?page=Transações, /?page=Orçamentos ou /?page=Metas. O Service Worker foca uma janela existente quando possível.