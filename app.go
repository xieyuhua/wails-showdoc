package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// App 是暴露给前端的 Wails 绑定对象，复刻原 node server 的 ShowDoc 私服代理逻辑。
type App struct {
	defaultBaseURL string
}

func NewApp() *App {
	base := os.Getenv("SHOWDOC_BASE_URL")
	if base == "" {
		base = "http://localhost:5757"
	}
	return &App{defaultBaseURL: base}
}

// GetConfig 返回默认私服地址（对应 node 的 GET /api/config）
func (a *App) GetConfig() (map[string]interface{}, error) {
	return map[string]interface{}{"showdocBaseUrl": a.defaultBaseURL}, nil
}

// configPath 返回本地配置文件路径（位于用户配置目录下的 ShowDocDocExport/config.json）
func configPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil || dir == "" {
		dir, err = os.Getwd()
		if err != nil {
			return "", err
		}
	}
	sub := filepath.Join(dir, "ShowDocDocExport")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		return "", err
	}
	return filepath.Join(sub, "config.json"), nil
}

// SaveConfig 把前端配置持久化到本地配置文件（JSON）。
// 入参为 map[string]interface{}，由前端传入 {baseUrl, apiKey, apiToken, itemId, projects}
func (a *App) SaveConfig(cfg map[string]interface{}) error {
	p, err := configPath()
	if err != nil {
		return err
	}
	if cfg == nil {
		cfg = map[string]interface{}{}
	}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, b, 0o600)
}

// LoadConfigFile 从本地配置文件读取上次保存的配置；文件不存在或损坏时返回空 map
func (a *App) LoadConfigFile() (map[string]interface{}, error) {
	p, err := configPath()
	if err != nil {
		return map[string]interface{}{}, err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]interface{}{}, nil
		}
		return map[string]interface{}{}, err
	}
	var cfg map[string]interface{}
	if err := json.Unmarshal(b, &cfg); err != nil {
		// 文件损坏时不报错，返回空，让前端回退到默认值
		return map[string]interface{}{}, nil
	}
	return cfg, nil
}

func resolveBaseUrl(raw, def string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		s = strings.TrimSpace(def)
	}
	if s == "" {
		return "", fmt.Errorf("缺少 ShowDoc 私服地址，请在页面填写「私服地址」（如 http://localhost:5757）")
	}
	if !strings.HasPrefix(s, "http://") && !strings.HasPrefix(s, "https://") {
		s = "http://" + s
	}
	u, err := url.Parse(s)
	if err != nil {
		return "", fmt.Errorf("私服地址不合法：%s（应为完整 URL，如 http://localhost:5757）", raw)
	}
	return strings.TrimRight(u.String(), "/"), nil
}

func apiUrl(base, p string) string {
	return base + "/server/index.php?s=/api/" + p
}

// post 向 ShowDoc 开放 API 发送 form 表单请求，并做与 node 版一致的错误解析
func (a *App) post(baseUrl, p string, params map[string]string) (map[string]interface{}, error) {
	base, err := resolveBaseUrl(baseUrl, a.defaultBaseURL)
	if err != nil {
		return nil, err
	}
	form := url.Values{}
	for k, v := range params {
		if v != "" {
			form.Set(k, v)
		}
	}
	u := apiUrl(base, p)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Post(u, "application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("无法连接 ShowDoc（%s）：%s", u, err.Error())
	}
	defer resp.Body.Close()
	text, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败：%s", err.Error())
	}
	var data map[string]interface{}
	if err := json.Unmarshal(text, &data); err != nil {
		snippet := strings.TrimSpace(string(text))
		if len(snippet) > 300 {
			snippet = snippet[:300]
		}
		body := string(text)
		if strings.Contains(body, "parseTemplate") || strings.Contains(body, "Call to a member function") || strings.Contains(body, "ThinkPHP") {
			return nil, fmt.Errorf("ShowDoc 返回了 PHP 错误页，通常是 api_key / api_token / item_id 不正确，或该密钥没有此项目的访问权限。请确认：① item_id 是「项目」ID；② api_key 与 api_token 来自该项目的「开放API」设置页；③ 三项属于同一项目。")
		}
		return nil, fmt.Errorf("ShowDoc 返回的不是 JSON（可能地址/路径不对）。HTTP %d，内容片段：%s", resp.StatusCode, snippet)
	}
	if ec, ok := data["error_code"]; ok {
		if code, ok := ec.(float64); ok && int(code) != 0 {
			if int(code) == 999 {
				return nil, fmt.Errorf("ShowDoc 拒绝了请求（error_code 999）。这是凭证/项目 ID 不对导致的，请逐项核对：\n① item_id 必须是「项目」ID（打开项目后地址栏 ?item_id= 后面的数字），不是某个接口页面的 ID；\n② api_key 与 api_token 必须来自「该项目」设置页里的「开放API」密钥对；\n③ 三项属于同一个项目；\n④ 若仍不行，可能是 ShowDoc 版本过旧，建议升级到最新版（该 999 是旧版已知 bug）。")
			}
			msg, _ := data["error_message"].(string)
			if msg == "" {
				msg = fmt.Sprintf("ShowDoc 返回错误码 %v", int(code))
			}
			return nil, fmt.Errorf("%s", msg)
		}
	}
	return data, nil
}

// extractTree 从 ShowDoc 返回的任意嵌套结构中深度扫描，提取全部目录(catalog)与页面(pages)
// 同时把父目录的 cat_id「向下传递」给嵌套页面：即使某个 ShowDoc 版本没有在 page 节点上
// 写 cat_id，也能保证页面归属到正确的目录（否则导出选择列表会全部平铺到顶层）。
func extractTree(root interface{}) map[string]interface{} {
	catalog := []map[string]interface{}{}
	pages := []interface{}{}
	seenCat := map[string]bool{}
	seenPage := map[string]bool{}

	var walk func(node interface{}, inheritedCatId interface{})
	walk = func(node interface{}, inheritedCatId interface{}) {
		switch n := node.(type) {
		case map[string]interface{}:
			// 目录：同时具备 cat_id 与 cat_name
			if _, ok := n["cat_id"]; ok {
				if _, ok2 := n["cat_name"]; ok2 {
					id := fmt.Sprintf("%v", n["cat_id"])
					if !seenCat[id] {
						seenCat[id] = true
						level := 1
						if lv, ok := n["level"]; ok {
							switch v := lv.(type) {
							case float64:
								level = int(v)
							case string:
								if i, err := strconv.Atoi(v); err == nil {
									level = i
								}
							}
						}
						var parent interface{} = nil
						if pc, ok := n["parent_cat_id"]; ok {
							parent = pc
						} else {
							parent = inheritedCatId
						}
						catalog = append(catalog, map[string]interface{}{
							"cat_id":        n["cat_id"],
							"cat_name":      fmt.Sprintf("%v", n["cat_name"]),
							"level":         level,
							"parent_cat_id": parent,
						})
					}
					// 进入该目录子节点时，以当前目录 id 作为继承值
					inheritedCatId = n["cat_id"]
				}
			}
			// 页面：同时具备 page_id 与 page_title
			if _, ok := n["page_id"]; ok {
				if _, ok2 := n["page_title"]; ok2 {
					id := fmt.Sprintf("%v", n["page_id"])
					if !seenPage[id] {
						seenPage[id] = true
						// 页面自身没有 cat_id 时，继承父目录 id
						if _, has := n["cat_id"]; !has {
							child := map[string]interface{}{}
							for k, v := range n {
								child[k] = v
							}
							child["cat_id"] = inheritedCatId
							pages = append(pages, child)
						} else {
							pages = append(pages, n)
						}
					}
				}
			}
			for _, v := range n {
				if vm, ok := v.(map[string]interface{}); ok {
					walk(vm, inheritedCatId)
				} else if va, ok := v.([]interface{}); ok {
					walk(va, inheritedCatId)
				}
			}
		case []interface{}:
			for _, item := range n {
				walk(item, inheritedCatId)
			}
		}
	}
	walk(root, nil)
	return map[string]interface{}{"catalog": catalog, "pages": pages}
}

// GetTree 读取接口树（对应 node 的 POST /api/showdoc/tree）
func (a *App) GetTree(baseUrl, apiKey, apiToken, itemId string) (map[string]interface{}, error) {
	if strings.TrimSpace(itemId) == "" {
		return nil, fmt.Errorf("缺少 item_id（ShowDoc 项目 ID）")
	}
	data, err := a.post(baseUrl, "item/info", map[string]string{
		"api_key":   apiKey,
		"api_token": apiToken,
		"item_id":   itemId,
	})
	if err != nil {
		return nil, err
	}
	extracted := extractTree(data)
	catalog := extracted["catalog"].([]map[string]interface{})
	pages := extracted["pages"].([]interface{})
	if len(catalog) == 0 && len(pages) == 0 {
		return map[string]interface{}{"catalog": catalog, "pages": pages, "raw": data}, nil
	}
	return map[string]interface{}{"catalog": catalog, "pages": pages}, nil
}

// GetPages 批量获取页面正文（对应 node 的 POST /api/showdoc/pages）
// 不同 ShowDoc 版本取单页正文的 action 名不同：先试 item/getPage，失败再试 page/info
func (a *App) GetPages(baseUrl, apiKey, apiToken string, pageIds []string) (map[string]interface{}, error) {
	if len(pageIds) == 0 {
		return nil, fmt.Errorf("缺少 pageIds")
	}
	actions := []string{"item/getPage", "page/info"}
	results := []map[string]interface{}{}
	for _, pid := range pageIds {
		var lastErr error
		done := false
		for _, act := range actions {
			d, err := a.post(baseUrl, act, map[string]string{
				"api_key":   apiKey,
				"api_token": apiToken,
				"page_id":   pid,
			})
			if err != nil {
				lastErr = err
				continue
			}
			pageData := d
			if inner, ok := d["data"]; ok {
				if m, ok2 := inner.(map[string]interface{}); ok2 {
					pageData = m
				}
			}
			pageData["page_id"] = pid
			results = append(results, pageData)
			done = true
			break
		}
		if !done {
			msg := ""
			if lastErr != nil {
				msg = lastErr.Error()
			}
			results = append(results, map[string]interface{}{"page_id": pid, "_error": msg})
		}
	}
	return map[string]interface{}{"pages": results}, nil
}

// UpdatePage 修改/更新一个接口页面内容（对应 ShowDoc 开放 API 的 item/page/edit）。
// pageId 为空时 ShowDoc 会新建页面；catId 为空表示挂到项目根目录。
func (a *App) UpdatePage(baseUrl, apiKey, apiToken, itemId, pageId, catId, pageTitle, pageContent string) (map[string]interface{}, error) {
	if strings.TrimSpace(itemId) == "" {
		return nil, fmt.Errorf("缺少 item_id（ShowDoc 项目 ID）")
	}
	if strings.TrimSpace(pageTitle) == "" {
		return nil, fmt.Errorf("页面标题（page_title）不能为空")
	}
	data, err := a.post(baseUrl, "item/page/edit", map[string]string{
		"api_key":      apiKey,
		"api_token":    apiToken,
		"item_id":      itemId,
		"page_id":      pageId,
		"cat_id":       catId,
		"page_title":   pageTitle,
		"page_content": pageContent,
	})
	if err != nil {
		return nil, err
	}
	return data, nil
}

// importPage 是前端传入的单个待导入页面
type importPage struct {
	CatPath     []string `json:"catPath"`
	PageTitle   string   `json:"pageTitle"`
	PageContent string   `json:"pageContent"`
}

// ImportOpenApi 把前端解析好的接口页面（含目录路径 + RunApi 内容）批量写回 ShowDoc。
//  1. 先拉取现有目录，复用已存在的目录（避免重复建目录）
//  2. 按 CatPath 逐级确保目录存在（缺失才新建）
//  3. 逐页用 item/page/edit 新建接口（page_id 留空 = 新建）
//
// pagesJson 必须是 importPage 数组的 JSON 字符串。
func (a *App) ImportOpenApi(baseUrl, apiKey, apiToken, itemId, pagesJson string) (map[string]interface{}, error) {
	if strings.TrimSpace(itemId) == "" {
		return nil, fmt.Errorf("缺少 item_id（ShowDoc 项目 ID）")
	}
	var pages []importPage
	if err := json.Unmarshal([]byte(pagesJson), &pages); err != nil {
		return nil, fmt.Errorf("pages 不是合法 JSON：%s", err.Error())
	}
	if len(pages) == 0 {
		return nil, fmt.Errorf("缺少要导入的 pages")
	}

	// 目录路径缓存："用户管理/账号" -> catId
	pathCache := map[string]string{}

	// 拉一次现有目录，把已存在目录的完整路径缓存起来，避免重复创建
	if info, err := a.post(baseUrl, "item/info", map[string]string{
		"api_key":   apiKey,
		"api_token": apiToken,
		"item_id":   itemId,
	}); err == nil {
		if extracted, ok := info["data"]; ok {
			ex := extractTree(extracted)
			if cats, ok := ex["catalog"].([]map[string]interface{}); ok {
				byId := map[string]map[string]interface{}{}
				for _, c := range cats {
					id := fmt.Sprintf("%v", c["cat_id"])
					byId[id] = c
				}
				pathOf := func(cid string) string {
					parts := []string{}
					cur, ok := byId[cid]
					for ok {
						parts = append([]string{fmt.Sprintf("%v", cur["cat_name"])}, parts...)
						pid := fmt.Sprintf("%v", cur["parent_cat_id"])
						if pid == "" || pid == "0" || pid == "<nil>" {
							break
						}
						cur, ok = byId[pid]
					}
					return strings.Join(parts, "/")
				}
				for _, c := range cats {
					pathCache[pathOf(fmt.Sprintf("%v", c["cat_id"]))] = fmt.Sprintf("%v", c["cat_id"])
				}
			}
		}
	}

	created := 0
	failed := 0
	errors := []string{}
	for _, pg := range pages {
		catPath := pg.CatPath
		if len(catPath) == 0 {
			catPath = []string{"(未分类)"}
		}
		parent := ""
		acc := ""
		ok := true
		for _, name := range catPath {
			if acc == "" {
				acc = name
			} else {
				acc = acc + "/" + name
			}
			if v, exists := pathCache[acc]; exists {
				parent = v
				continue
			}
			pc := parent
			if pc == "" {
				pc = "0"
			}
			d, err := a.post(baseUrl, "item/insertCatalog", map[string]string{
				"api_key":       apiKey,
				"api_token":     apiToken,
				"item_id":       itemId,
				"cat_name":      name,
				"parent_cat_id": pc,
			})
			if err != nil {
				errors = append(errors, fmt.Sprintf("• %s：新建目录失败 %s", pg.PageTitle, err.Error()))
				failed++
				ok = false
				break
			}
			catId := ""
			if data, ok2 := d["data"].(map[string]interface{}); ok2 {
				catId = fmt.Sprintf("%v", data["cat_id"])
			}
			if catId == "" || catId == "<nil>" {
				errors = append(errors, fmt.Sprintf("• %s：新建目录未返回 cat_id", pg.PageTitle))
				failed++
				ok = false
				break
			}
			pathCache[acc] = catId
			parent = catId
		}
		if !ok {
			continue
		}
		if parent == "" {
			parent = "0"
		}
		if _, err := a.post(baseUrl, "item/page/edit", map[string]string{
			"api_key":      apiKey,
			"api_token":    apiToken,
			"item_id":      itemId,
			"page_id":      "",
			"cat_id":       parent,
			"page_title":   pg.PageTitle,
			"page_content": pg.PageContent,
		}); err != nil {
			errors = append(errors, fmt.Sprintf("• %s：%s", pg.PageTitle, err.Error()))
			failed++
			continue
		}
		created++
	}
	return map[string]interface{}{
		"ok":      true,
		"total":   len(pages),
		"created": created,
		"failed":  failed,
		"errors":  errors,
	}, nil
}
