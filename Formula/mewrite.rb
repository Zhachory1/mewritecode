class Mewrite < Formula
  desc "Me Write Code terminal coding agent"
  homepage "https://github.com/Zhachory1/mewritecode"
  version "0.66.9"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/Zhachory1/mewritecode/releases/download/v#{version}/mewrite-darwin-arm64.tar.gz"
      sha256 "b26fb2c2f9550b8dc180684942858efb7a4a3e1155be96f92bb089fb12e5887a"
    end
    on_intel do
      url "https://github.com/Zhachory1/mewritecode/releases/download/v#{version}/mewrite-darwin-x64.tar.gz"
      sha256 "95c6d7c6da11cd098a9ba95126b4653f2d3129bb2ad5a37868c891c2f24879c4"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/Zhachory1/mewritecode/releases/download/v#{version}/mewrite-linux-arm64.tar.gz"
      sha256 "f2674fbdeca687f4f2f70413f2c11ec9a1b0c49fb42ee7a27ef69abf0ec72fad"
    end
    on_intel do
      url "https://github.com/Zhachory1/mewritecode/releases/download/v#{version}/mewrite-linux-x64.tar.gz"
      sha256 "fd77c199886ace34ac3de832c3b77e2898acd73e57629ad98532f47e9f98552a"
    end
  end

  def install
    # mewrite resolves theme/, export-html/, photon_rs_bg.wasm, etc. relative to
    # dirname(process.execPath), so the binary and companions must live together.
    libexec.install Dir["*"]
    bin.write_exec_script libexec/"mewrite"
    bin.install_symlink bin/"mewrite" => "mewrite-code"
    bin.install_symlink bin/"mewrite" => "mewritecode"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/mewrite --version")
  end
end
