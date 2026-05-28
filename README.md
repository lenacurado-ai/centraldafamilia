# Central da Familia

App simples para celular com comando por voz.

## Como publicar

1. Crie uma conta na Vercel.
2. Envie esta pasta como um novo projeto.
3. Em Settings > Environment Variables, adicione `OPENAI_API_KEY`.
4. Publique e abra o link no celular.
5. No navegador do celular, use "Adicionar a tela inicial".

## Por que existe uma API

O HTML do navegador nao deve guardar chaves secretas. A rota `api/voice.js` fica do lado da hospedagem, usa a chave da OpenAI com seguranca e devolve apenas o resultado para a tela.

## Proximos conectores

- Google Calendar para criar consultas.
- Google Drive para buscar arquivos.
- Google Sheets, Supabase ou Notion para guardar anotacoes.

Esses conectores podem ser feitos direto no codigo ou por uma ferramenta visual como Make.

## Integracao direta ou Make

Make e parecido com uma central visual de conectores. Ele economiza tempo quando voce quer ligar Google Calendar, Drive, Gmail, planilhas e IA sem criar telas de autorizacao.

Integracao direta tambem funciona. Nesse caso o app precisa de:

- uma API segura, como `api/voice.js`, para nao expor chaves no navegador;
- autorizacao OAuth do Google para acessar Calendar e Drive;
- um lugar para guardar notas e historico, como Supabase, Google Sheets ou banco da propria hospedagem.

Esta base ja esta preparada para o caminho direto: o navegador grava o audio, a API transcreve e interpreta, e depois podemos adicionar as acoes reais.
