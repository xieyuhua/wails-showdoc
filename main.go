package main

import (
	"embed"
	"io/fs"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:dist
var assets embed.FS

func main() {
	app := NewApp()

	// 前端构建产物位于 ./dist，用 fs.Sub 把它作为 asset server 的根
	dist, err := fs.Sub(assets, "dist")
	if err != nil {
		panic(err)
	}

	err = wails.Run(&options.App{
		Title:  "ShowDoc 文档导出",
		Width:  1280,
		Height: 800,
		AssetServer: &assetserver.Options{
			Assets: dist,
		},
		BackgroundColour: &options.RGBA{R: 255, G: 255, B: 255, A: 1},
		Bind: []interface{}{
			app,
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
