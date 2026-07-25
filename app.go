package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
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
func extractTree(root interface{}) map[string]interface{} {
	catalog := []map[string]interface{}{}
	pages := []interface{}{}
	seenCat := map[string]bool{}
	seenPage := map[string]bool{}

	var walk func(node interface{})
	walk = func(node interface{}) {
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
						}
						catalog = append(catalog, map[string]interface{}{
							"cat_id":        n["cat_id"],
							"cat_name":      fmt.Sprintf("%v", n["cat_name"]),
							"level":         level,
							"parent_cat_id": parent,
						})
					}
				}
			}
			// 页面：同时具备 page_id 与 page_title
			if _, ok := n["page_id"]; ok {
				if _, ok2 := n["page_title"]; ok2 {
					id := fmt.Sprintf("%v", n["page_id"])
					if !seenPage[id] {
						seenPage[id] = true
						pages = append(pages, n)
					}
				}
			}
			for _, v := range n {
				if vm, ok := v.(map[string]interface{}); ok {
					walk(vm)
				} else if va, ok := v.([]interface{}); ok {
					walk(va)
				}
			}
		case []interface{}:
			for _, item := range n {
				walk(item)
			}
		}
	}
	walk(root)
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
