# Contratos HTTP de escrita — 11/11/2026

## Constatações do código atual

O exemplo `updateScheduleBlock(updateData: any)` **não corresponde ao estado local
inicial desta etapa**: o controller já usava `UpdateScheduleBlockDto` e o service
já tinha projeção explícita, decorrentes das correções anteriores. Não se confirmou
uma transferência de empresa por esse endpoint no código atual.

A configuração global foi preservada: `ValidationPipe` com `whitelist: true`,
`forbidNonWhitelisted: true` e `transform: true`. Ela rejeita propriedades extras
quando o parâmetro possui uma classe DTO com metadados de validação. Tipos inline
TypeScript não fornecem esses metadados em runtime.

| Caminho revisado | Constatação | Tratamento |
|---|---|---|
| POST/PUT /admin/schedule-blocks | DTOs existentes; opcionais não anuláveis aceitavam null; recorrência não era validada como estado resultante do patch | DTOs reforçados, normalização e validação conjunta com o registro persistido |
| PUT /admin/service-modes/rules/:ruleId | Tipo inline; duração/preço sem validação runtime; campos extras não rejeitados | Classe DTO, inteiros, duração positiva e preço não negativo |
| POST /admin/service-modes/:id/rules | DTO existente aceitava números negativos/fracionários | Mesmas restrições numéricas da atualização |
| PUT /extra-services/requests/:id/status | Tipo inline; cast de string não validava enum | Classe DTO com enum de status existentes, sem inventar transições de produto |
| DELETE /push-notifications/unsubscribe | Tipo inline permitia endpoint com tipo inesperado chegar ao filtro Prisma | Classe DTO com string não vazia; tenant/usuário continuam vindo da autenticação |
| POST/PUT /addresses | DTO no controller já rejeitava campos protegidos; service repassava objeto/spread ao Prisma | Mapeamento explícito; filtros de atualização/exclusão incluem empresa e proprietário |
| PUT /business/branding e /business/address | DTOs já protegiam a borda HTTP; repasse de objeto/spread no service | Mapeamento explícito de propriedades permitidas |
| POST/PUT /extra-services e POST /extra-services/requests | DTOs existentes já rejeitavam propriedades extras; spreads no service | Projeções explícitas, IDs confiáveis e ordem de exibição gerados/controlados pelo servidor |

Nos casos com DTO já existente, a inspeção **não demonstra exploração HTTP de mass
assignment**: a troca do spread é defesa adicional para chamadas internas e para
evitar que uma futura expansão do DTO libere colunas automaticamente.

Também foram inspecionadas as escritas de autenticação, usuários/clientes,
agendamentos, modalidades, tipos de veículo, notificações e dispositivos push.
Não foram encontrados outros repasses equivalentes de corpo HTTP inteiro para
`data` do Prisma nos caminhos examinados. Operações internas tipadas e campos
escalares extraídos explicitamente não foram transformados em refatoração geral.

## Lista positiva do produto

| Operação | Campos do corpo aceitos |
|---|---|
| Criar bloqueio | type, blockDate, blockStartTime, blockEndTime, reason, isRecurring, recurringDays, recurringEndDate |
| Atualizar bloqueio | type, startAt, endAt, reason, isRecurring, recurringDays, recurringEndDate, isActive |
| Endereço do cliente | streetAddress, number, complement, neighborhood, city, state, zipCode, latitude, longitude, addressType, isDefault, label |
| Branding | logoUrl, iconUrl, primaryColor, secondaryColor, accentColor |
| Endereço da empresa | streetAddress, number, complement, neighborhood, city, state, zipCode, latitude, longitude |
| Criar/atualizar extra | name, description, imageUrl, estimatedPriceInCents, isActive |
| Solicitar extra | extraServiceId (validado na empresa), description |
| Atualizar regra de modalidade | durationMinutes, basePriceInCents |
| Atualizar status de solicitação | status |
| Desinscrever Web Push | endpoint |

`id`, `businessId`, `customerId` fora dos contratos próprios, `createdAt`, `updatedAt`,
`deletedAt`, `displayOrder` e relações Prisma (`connect`, `set` etc.) não são liberados
por esses DTOs/projeções. Os IDs das rotas são identificadores opacos, não autorização:
a propriedade é verificada contra empresa/usuário autenticados. `deletedAt` só é
gravado pelos métodos próprios de exclusão; timestamps internos ficam com o servidor.

## Bloqueios: período, recorrência e normalização

- Trim em motivo e strings de data/hora; dias da semana normalizados para uppercase.
  Não há coerção de `"false"` para boolean nem de strings numéricas para números.
- `type`, `startAt`, `endAt`, `isRecurring` e `isActive` não aceitam null.
  `reason: null` permite limpar o motivo; `recurringEndDate: null` permite recorrência
  sem data final. Dias nulos/vazios não são permitidos se a recorrência estiver ativa.
- Datas de criação são civis; instantes de atualização exigem offset explícito.
  Datas inexistentes, horas inválidas e fim menor/igual ao início são rejeitados.
- O patch é combinado com o registro existente antes de validar. Mudar o início
  para depois do fim da recorrência falha mesmo sem reenviar `recurringEndDate`.
- Recorrência ativa exige entre 1 e 7 dias válidos, distintos. O término é inclusivo
  e não pode ser anterior à data local do início.
- Ao desligar a recorrência, os dias e o término são limpos. Enviar dias não vazios
  ou término junto com `isRecurring: false` é contraditório e retorna 400.
- Mudanças de período/tipo para FULL_DAY precisam corresponder a um dia inteiro no
  timezone da empresa. O limite legado inclusivo 23:59:59.999 permanece aceito sem
  regravação automática. As regras IANA/DST da etapa anterior permanecem aplicadas.
- Permanecem o bloqueio transacional por empresa, checagem de exclusão lógica e
  `where: { id, businessId, deletedAt: null }` na atualização do bloqueio.

## Validação e limites

- **232 testes comuns aprovados**, incluindo 58 novos testes nesta etapa: contratos
  de bloqueios, payloads HTTP com os guards reais e projeções dos services.
- **20 testes PostgreSQL aprovados**, executados separadamente pelo comando
  `npm run test:concurrency`, em container local descartável removido ao final.
- Build do backend aprovado; `git diff --check` sem erros.
- Cobertura negativa: campos desconhecidos/protegidos, tenant/owner estrangeiros,
  null indevido, objetos Prisma no payload, enum inválido, valores negativos,
  datas/horas/períodos inválidos e recorrência incoerente.
- Cobertura positiva: campos do produto, normalização, recorrência aberta/fechada,
  desativação, limites legados de FULL_DAY e preservação do isolamento.
- As restrições novas rejeitam entradas inválidas que antes podiam alcançar Prisma
  ou resultar em erro 500. Payloads válidos mantêm nomes e tipos; nenhuma rota nova.
- Nenhuma mudança no frontend/Android nesta etapa. Alterações anteriores locais
  foram preservadas. Nenhum acesso a banco de produção, migração, commit ou deploy.
