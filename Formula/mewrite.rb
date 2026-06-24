class Mewrite < Formula
  desc "Me Write Code terminal coding agent"
  homepage "https://github.com/Zhachory1/mewritecode"
  version "0.66.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/Zhachory1/mewritecode/releases/download/v#{version}/mewrite-darwin-arm64.tar.gz"
      sha256 "7f92b37597475652723adc389c66a75f9b5fa91ff0da1d3e6f712b9470041744"
    end
    on_intel do
      url "https://github.com/Zhachory1/mewritecode/releases/download/v#{version}/mewrite-darwin-x64.tar.gz"
      sha256 "cdf55461486182091a4733f350d45d0464e694d0a8641035df58157273ff9078"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/Zhachory1/mewritecode/releases/download/v#{version}/mewrite-linux-arm64.tar.gz"
      sha256 "1994ba159280c5789f8d2ef8abcfc0ff91ee2de7c683549ac553aa3807eb4e72"
    end
    on_intel do
      url "https://github.com/Zhachory1/mewritecode/releases/download/v#{version}/mewrite-linux-x64.tar.gz"
      sha256 "17aa645b980d745dbe71817447215bb3226b782a1eb0c946f66041eb4d64d778"
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
