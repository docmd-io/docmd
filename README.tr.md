<div align="right">
  <sup>
    <a href="./README.md">EN</a> &nbsp;|&nbsp; <a href="./README.de.md">DE</a> &nbsp;|&nbsp; <a href="./README.zh.md">中文</a> &nbsp;|&nbsp; <a href="./README.es.md">ES</a> &nbsp;|&nbsp; <a href="./README.ja.md">日本語</a> &nbsp;|&nbsp; <a href="./README.fr.md">FR</a> &nbsp;|&nbsp; <a href="./README.ru.md">RU</a> &nbsp;|&nbsp; <b>TR</b>
  </sup>
</div>

<div align="center">

  <a href="https://docmd.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://github.com/docmd-io/docmd/blob/main/packages/ui/assets/images/docmd-logo-dark.png?raw=true" />
      <source media="(prefers-color-scheme: light)" srcset="https://github.com/docmd-io/docmd/blob/main/packages/ui/assets/images/docmd-logo-dark.png?raw=true" />
      <img src="https://github.com/docmd-io/docmd/blob/main/packages/ui/assets/images/docmd-logo-dark.png?raw=true" alt="docmd" width="210" />
    </picture>
  </a>

  <br/>

  <p>
    <b>İnsanlar ve makineler için dokümantasyon.</b><br/>
    Tek bir Markdown kaynağı → web sitesi, arama, yapay zeka bağlamı, ajanlar ve bilgi formatları.
  </p>

  <p>
    <a href="https://www.npmjs.com/package/@docmd/core"><img src="https://img.shields.io/npm/v/@docmd/core.svg?style=flat-square&color=CB3837" alt="npm version"></a>
    <a href="https://www.npmjs.com/package/@docmd/core?activeTab=versions"><img src="https://img.shields.io/npm/dm/@docmd/core.svg?style=flat-square&color=38bd24" alt="monthly downloads"></a>
    <a href="https://github.com/docmd-io/docmd"><img src="https://img.shields.io/github/stars/docmd-io/docmd?style=flat-square&logo=github" alt="GitHub stars"></a>
    <a href="https://github.com/docmd-io/docmd/blob/main/LICENSE"><img src="https://img.shields.io/github/license/docmd-io/docmd.svg?style=flat-square&color=A31F34" alt="license"></a>
  </p>

  <h4>
    <a href="https://docmd.io">Web Sitesi</a> &nbsp;·&nbsp;
    <a href="https://docs.docmd.io">Belgeler</a> &nbsp;·&nbsp;
    <a href="https://cloud.docmd.io">Cloud Relay</a> &nbsp;·&nbsp;
    <a href="https://live.docmd.io">Canlı Düzenleyici</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd-skills">Ajan Becerileri</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd/issues">Sorun Bildir</a>
  </h4>

  <br/>

  <a href="https://docmd.io">
    <img width="820" alt="docmd documentation — light and dark mode preview" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-cover.webp" />
  </a>

</div>

## Hızlı Başlangıç

docmd'yi bir Markdown dosyaları klasörüne yönlendirin:

```bash
npx @docmd/core dev
```

`http://localhost:3000` adresini açın.

Bu kadar. Gezinme menüsü dosya yapınızdan otomatik oluşturulur. Yapılandırma dosyası, frontmatter veya harici bir çatı gerektirmez.

Dağıtıma hazır olduğunuzda:

```bash
npx @docmd/core build
```

docmd; Vercel, Cloudflare Pages, Netlify, GitHub Pages, S3, NGINX, Caddy veya herhangi bir statik sunucuya dağıtılabilecek statik bir site oluşturur.

**Node.js 20+ gerektirir.**

<details>
  <summary><b>Küresel yükleme ve Docker</b></summary>

<br/>

Genel (global) olarak yükleyin:

```bash
npm install -g @docmd/core

# veya
pnpm add -g @docmd/core
```

Ardından:

```bash
docmd dev
docmd build
```

Veya Docker ile çalıştırın:

```bash
docker run -p 3000:3000 ghcr.io/docmd-io/docmd:latest
```

> Tekrarlanabilir üretim derlemeleri için Docker imajını belirli bir sürüme sabitleyin.

</details>

## Tek Kaynak. Her Çıktı.

docmd açık kaynaklı bir dokümantasyon derleyicisidir.

docmd, Markdown içeriğinizi yalnızca bir web sitesi girdisi olarak görmek yerine, aynı kaynaktan okuyucular, arama motorları, LLM'ler, kodlama ajanları ve bilgi sistemleri için çıktılar derler.

```text
Markdown
   │
   ▼
 docmd
   │
   ├── → Statik dokümantasyon sitesi
   ├── → Çevrimdışı arama dizini
   ├── → llms.txt / llms-full.txt
   ├── → Açık Bilgi Formatı (OKF)
   ├── → Site haritası + SEO meta verileri
   ├── → robots.txt + Open Graph
   ├── → Yapay zeka ajanları için MCP arayüzü
   └── → Yapay Zeka Asistanı bağlamı
```

Tek bir kaynak ağacı. Tek bir derleme hattı. Ayrı ayrı dokümantasyon ve yapay zeka bilgi yığınları yönetmeye gerek yok.

## Neden docmd?

Dokümantasyonun artık birden fazla okuyucusu var.

İnsanlar hızlı, gezilebilir bir web sitesine ihtiyaç duyar. Arama motorları yapılandırılmış meta verilere ihtiyaç duyar. LLM'ler temiz bağlama ihtiyaç duyar. Kodlama ajanları araçlara ve protokollere ihtiyaç duyar. RAG sistemleri yapılandırılmış bilgiye ihtiyaç duyar.

docmd, Markdown'ı merkezde tutarak tüm bunları bir arada oluşturur.

<a href="https://docs.docmd.io/comparison/">
  <img width="800" alt="docmd comparison with other documentation tools" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-comparison.webp" />
</a>
<br/>
<b><a href="https://docs.docmd.io/comparison/">Docusaurus, Mintlify ve diğer dokümantasyon araçlarıyla eksiksiz karşılaştırmayı görün →</a></b>

## Özellikler

### Sıfır yapılandırma, anında başlangıç

docmd'yi herhangi bir Markdown klasörüne yönlendirin ve hemen çalışsın. Gezinme, dosya yapınızdan otomatik olarak oluşturulur — başlamak için ortak kod kalıplarına, frontmatter'a veya derleme süreçlerine gerek yoktur.

### Varsayılan olarak hafif, her yerde hızlı

docmd, minimum saf JavaScript ve hızlı SPA tarzı gezinme ile statik HTML üretir. Çevrimdışı tam metin arama, site haritası, kurallı URL'ler (canonical), Open Graph meta verileri ve diğer temel özellikler çıktının içinde yerleşik olarak bulunur.

### Yapay Zeka ve Ajanlara Hazır

docmd, makine tarafından okunabilir dokümantasyonu ayrı bir yayınlama iş akışı olarak değil, derlemenin doğal bir parçası olarak ele alır.

* **Yapay Zeka Asistanı** — Belgelerinize dayanan RAG destekli sohbet
* **MCP Sunucusu** — Uyumlu kodlama ajanlarının belgelerinizi aramasına, okumasına ve doğrulamasına olanak tanır
* **`llms.txt` / `llms-full.txt`** — LLM tarafından okunabilir eksiksiz dokümantasyon bağlamı
* **Açık Bilgi Formatı (OKF)** — Yapay zeka ve RAG sistemleri için yapılandırılmış bilgi paketleri
* **Ajan Becerileri (Agent Skills)** — LLM'ler ve kodlama ajanları için yeniden kullanılabilir talimatlar
* **Markdown Olarak Kopyala / Bağlamı Kopyala** — Doğrudan tarayıcıdan temiz bağlam çıkarma
* **Semantik Arama** — Yerleşik anahtar kelime aramasının yanında isteğe bağlı vektör tabanlı arama

### Büyümek için Tasarlandı

* Yerel arama ve otomatik çıktılarla yerelleştirme (i18n)
* Birden çok dokümantasyon sürümü desteği (sürümleme)
* Monorepo'lar ve çok projeli yapılar için Çalışma Alanları (Workspaces)
* API dokümantasyonu için OpenAPI 3.x oluşturucu
* Yerleşik temalar, özel CSS/JavaScript ve açık/koyu mod

## Yapay Zeka Asistanı ve Cloud Relay

docmd, dokümantasyonunuza dayanan RAG destekli bir Yapay Zeka Asistanı içerir.

Bunu kendi arka ucunuza veya yerel yapay zeka sağlayıcınıza bağlayabilirsiniz. Dokümantasyonunuz statik bir site olarak dağıtılmışsa, **docmd Cloud Relay** barındırılan güvenli köprüyü sağlar.

```text
Dokümantasyonunuz
        │
        ▼
 @docmd/plugin-ai
        │
        ▼
 docmd Cloud Relay
        │
        ▼
Yapay zeka sağlayıcınız
```

Cloud Relay, sağlayıcı kimlik bilgilerinin tarayıcıya gönderilmesine gerek kalmadan ve bir yapay zeka arka ucu işletmenize gerek kalmadan, yapay zeka isteklerini seçtiğiniz sağlayıcıya güvenli bir şekilde iletir.

**Cloud Relay, kendi yapay zeka sağlayıcı anahtarınızla ücretsiz olarak kullanılabilir.**

* Kendi sağlayıcınızı ve modelinizi getirin (BYOK)
* Sağlayıcı kimlik bilgilerini istemciden uzakta tutun
* Statik barındırma ile uyumludur
* Dağıtılacak veya sürdürülecek yapay zeka arka ucu yoktur
* Kullanım görünürlüğü ve okuyucu sorularına dair içgörüler
* Tek bir hesaptan birden fazla dokümantasyon projesi bağlayın

**[Cloud Relay Kurulumu →](https://cloud.docmd.io)** • [Yapay Zeka Asistanı belgeleri →](https://docs.docmd.io/guides/ai/ai-assistant/)

> Cloud Relay kullanımı ücretsizdir. Model kullanım ücretleri, seçtiğiniz yapay zeka sağlayıcısı tarafından ayrıca faturalandırılabilir.

## Komut Satırı Arayüzü (CLI)

```bash
docmd dev            # Yerel geliştirme sunucusunu başlatır
docmd build          # Üretim için derleme yapar
docmd live           # Tarayıcı tabanlı Canlı Düzenleyiciyi başlatır
docmd init           # Bir yapılandırma dosyası oluşturur
docmd doctor         # Yapılandırma ve eklenti durumunu denetler
docmd validate       # Dahili dokümantasyon bağlantılarını doğrular
docmd migrate        # Docusaurus, VitePress, MkDocs veya Starlight'tan geçiş yapar
docmd deploy         # Dağıtım yapılandırmasını oluşturur
docmd mcp            # stdio üzerinden MCP sunucusunu çalıştırır
docmd add <name>     # Bir eklenti veya tema yükler
docmd stop           # Çalışan docmd geliştirme sunucularını durdurur
```

**Tüm [CLI Komutlarını Görün →](https://docs.docmd.io/reference/cli-commands/)**

## Eklentiler

docmd bir eklenti sistemi üzerine inşa edilmiştir. Yaygın dokümantasyon özellikleri çekirdekle birlikte gelirken, isteğe bağlı eklentiler ihtiyaç duyulduğunda kurulabilir.

| Eklenti     |  Durum   | Açıklama                                                              |
| :---------- | :------: | :-------------------------------------------------------------------- |
| `ai`        | Çekirdek | BYOK, yerel sağlayıcılar ve Cloud Relay ile RAG Yapay Zeka Asistanı   |
| `search`    | Çekirdek | İsteğe bağlı anlamsal arama ile çevrimdışı anahtar kelime araması     |
| `seo`       | Çekirdek | SEO ve Open Graph meta verileri                                       |
| `sitemap`   | Çekirdek | `sitemap.xml` oluşturur                                               |
| `git`       | Çekirdek | Git geçmişi ve son güncelleme meta verileri                           |
| `analytics` | Çekirdek | Hafif analitik entegrasyonu                                           |
| `llms`      | Çekirdek | `llms.txt` ve `llms-full.txt` dosyalarını oluşturur                   |
| `okf`       | Çekirdek | Açık Bilgi Formatı (OKF) paketleri                                    |
| `mermaid`   | Çekirdek | Mermaid diyagram oluşturma                                            |
| `openapi`   | Çekirdek | OpenAPI 3.x dokümantasyon oluşturucu                                  |
| `pwa`       | İsteğe bağlı | Progresif Web Uygulaması ve çevrimdışı gezinme                    |
| `threads`   | İsteğe bağlı | Satır içi dokümantasyon tartışmaları *(geliştiren: @svallory)*    |
| `math`      | İsteğe bağlı | KaTeX / LaTeX formül desteği                                      |

İsteğe bağlı bir eklenti yükleyin:

```bash
docmd add <eklenti-adi>
```

**Kendinizinkini geliştirin: [Eklenti Geliştirme Kılavuzu →](https://docs.docmd.io/development/building-plugins/)**

## Yapılandırma

Yapılandırma isteğe bağlıdır.

Daha fazla kontrole ihtiyaç duyduğunuzda proje kök dizinine `docmd.config.json`, `docmd.config.ts` veya `docmd.config.js` ekleyin:

```json
{
  "title": "Projem",
  "url": "https://docs.projem.com",
  "src": "./docs",
  "out": "./dist"
}
```

Dinamik değerler gerektiğinde TypeScript ve JavaScript yapılandırmaları kullanılabilir.

**[Yapılandırma referansı →](https://docs.docmd.io/configuration/overview)**

## Programatik API

docmd'yi Node.js betiklerinizden, CI/CD süreçlerinizden veya özel derleme sistemlerinizden kullanabilirsiniz.

```javascript
import { build } from '@docmd/core';

// Dokümantasyonu programatik olarak derleyin.
await build('./docmd.config.json', { isDev: false });
```

CommonJS ve ESM desteklenir.

**[Node API referansı →](https://docs.docmd.io/development/node-api-reference/)**

## Geçiş (Migration)

Mevcut dokümantasyonunuza sıfırdan başlamanıza gerek yoktur.

```bash
docmd migrate
```

Docusaurus, VitePress, MkDocs ve Starlight dahil olmak üzere desteklenen çerçeveler için geçiş araçları mevcuttur.

**[Geçiş belgeleri →](https://docs.docmd.io)**

## Açık Kaynak

Dokümantasyonunuz, projenizin entelektüel kalbidir. Git deponuzda düz Markdown dosyalarında yer almalıdır — taşınabilir, sürüm kontrollü ve denetlenebilir.

**docmd derleyicisi ve resmi çekirdek eklentileri MIT lisanslıdır ve hiçbir zaman ücretli özellik duvarı barındırmayacaktır.**

Oluşturulan dokümantasyon herhangi bir yerde barındırılabilir ve docmd tarafından barındırılan bir altyapı gerektirmez.

## Topluluk

* **Belgeler** → [docs.docmd.io](https://docs.docmd.io)
* **Sorular ve Fikirler** → [GitHub Discussions](https://github.com/orgs/docmd-io/discussions)
* **Hatalar ve Özellik İstekleri** → [GitHub Issues](https://github.com/docmd-io/docmd/issues)
* **Katkıda Bulunma** → [CONTRIBUTING.md](.github/CONTRIBUTING.md)
* **Yol Haritası** → [GitHub Discussions](https://github.com/orgs/docmd-io/discussions/2)

## docmd'yi Destekleyin

docmd sizin için yararlı olduysa:

* Depoya bir ⭐ verin
* Dokümantasyon geliştiren biriyle paylaşın
* Sorun bildirin, düzeltmeler gönderin veya bir eklenti oluşturun
* [GitHub'da geliştirmeyi destekleyin](https://github.com/sponsors/mgks)

## Lisans

MIT Lisansı. Ayrıntılar için [LICENSE](LICENSE) dosyasına bakın.
