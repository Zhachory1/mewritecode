Add this APT repository with:

echo "deb [trusted=yes] https://raw.githubusercontent.com/Zhachory1/mewritecode/gh-pages/apt ./" | sudo tee /etc/apt/sources.list.d/mewrite.list
sudo apt update
sudo apt install mewrite-code
